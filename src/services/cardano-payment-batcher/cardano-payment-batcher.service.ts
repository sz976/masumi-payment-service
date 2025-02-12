import { $Enums, HotWallet } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { Transaction, mBool, resolvePaymentKeyHash } from "@meshsdk/core";
import { logger } from "@/utils/logger";
import { generateWalletExtended } from "@/utils/generator/wallet-generator";
import { delayErrorResolver, advancedRetry } from "advanced-retry";
import { SmartContractState } from "@/utils/generator/contract-generator";
import { getSmartContractStateDatum } from "@/utils/generator/contract-generator";

const updateMutex = new Sema(1);



export async function batchLatestPaymentEntriesV1() {

    const maxBatchSize = 10;
    const minTransactionCalculation = 1952430n;

    const acquiredMutex = await updateMutex.tryAcquire();
    //if we are already performing an update, we wait for it to finish and return
    if (!acquiredMutex)
        return await updateMutex.acquire();

    try {
        const networkChecksWithWalletLocked = await prisma.$transaction(async (prisma) => {
            const networkChecks = await prisma.networkHandler.findMany({
                where: {
                    HotWallets: {
                        some: {
                            PendingTransaction: null,
                            type: "PURCHASING"
                        }
                    }
                },
                include: {
                    PurchaseRequests: {
                        where: {
                            CurrentStatus: {
                                status: $Enums.PurchasingRequestStatus.PurchaseRequested,
                                errorType: null,
                                Transaction: null
                            }
                        },
                        include: {
                            Amounts: true,
                            SellerWallet: true,
                            SmartContractWallet: true,
                            CurrentStatus: true,

                        }
                    },
                    NetworkHandlerConfig: true,
                    HotWallets: {
                        where: {
                            PendingTransaction: null,
                            type: "PURCHASING"
                        },
                        include: {
                            Secret: true
                        }
                    }
                }
            })
            const walletsToLock: HotWallet[] = []
            for (const networkCheck of networkChecks) {
                for (const wallet of networkCheck.HotWallets) {
                    if (!walletsToLock.some(w => w.id === wallet.id)) {
                        walletsToLock.push(wallet);
                        await prisma.hotWallet.update({
                            where: { id: wallet.id },
                            data: { PendingTransaction: { create: { txHash: null } } }
                        })
                    }
                }
            }

            return networkChecks;
        })

        await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {
            const paymentRequests = networkCheck.PurchaseRequests;
            if (paymentRequests.length == 0) {
                logger.info("no payment requests found for network " + networkCheck.network + " " + networkCheck.paymentContractAddress)
                return;
            }

            const potentialWallets = networkCheck.HotWallets;

            const walletAmounts = await Promise.all(potentialWallets.map(async (wallet) => {
                const { wallet: meshWallet, } = await generateWalletExtended(networkCheck.network, networkCheck.NetworkHandlerConfig.rpcProviderApiKey, wallet.Secret.secret)
                const amounts = await meshWallet.getBalance();

                //TODO check if conversion to float fails
                return {
                    wallet: meshWallet,
                    walletId: wallet.id,
                    scriptAddress: networkCheck.paymentContractAddress,
                    amounts: amounts.map((amount) => ({ unit: amount.unit, quantity: parseFloat(amount.quantity) }))
                }
            }))
            const paymentRequestsRemaining = [...paymentRequests];
            const walletPairings = [];
            let maxBatchSizeReached = false;
            //TODO: greedy search?
            for (const walletData of walletAmounts) {
                const wallet = walletData.wallet;
                const amounts = walletData.amounts;
                const batchedPaymentRequests = [];

                let index = 0;
                while (paymentRequestsRemaining.length > 0 && index < paymentRequestsRemaining.length) {
                    if (batchedPaymentRequests.length >= maxBatchSize) {
                        maxBatchSizeReached = true;
                        break;
                    }
                    const paymentRequest = paymentRequestsRemaining[index];


                    //set min ada required;
                    const lovelaceRequired = paymentRequest.Amounts.findIndex((amount) => amount.unit.toLowerCase() == "lovelace");
                    if (lovelaceRequired == -1) {
                        paymentRequest.Amounts.push({ unit: "lovelace", amount: minTransactionCalculation, id: "", createdAt: new Date(), updatedAt: new Date(), paymentRequestId: null, purchaseRequestId: null })
                    } else {
                        const result = paymentRequest.Amounts.splice(lovelaceRequired, 1);
                        paymentRequest.Amounts.push({ unit: "lovelace", amount: minTransactionCalculation > result[0].amount ? minTransactionCalculation : result[0].amount, id: "", createdAt: new Date(), updatedAt: new Date(), paymentRequestId: null, purchaseRequestId: null })
                    }
                    let isFulfilled = true;
                    for (const paymentAmount of paymentRequest.Amounts) {
                        const walletAmount = amounts.find((amount) => amount.unit == paymentAmount.unit);
                        if (walletAmount == null || paymentAmount.amount > walletAmount.quantity) {
                            isFulfilled = false;
                            break;
                        }
                    }
                    if (isFulfilled) {
                        batchedPaymentRequests.push(paymentRequest);
                        //deduct amounts from wallet
                        for (const paymentAmount of paymentRequest.Amounts) {
                            const walletAmount = amounts.find((amount) => amount.unit == paymentAmount.unit);
                            walletAmount!.quantity -= parseInt(paymentAmount.amount.toString());
                        }
                        paymentRequestsRemaining.splice(index, 1);

                    } else {
                        index++;
                    }
                }

                walletPairings.push({ wallet: wallet, scriptAddress: walletData.scriptAddress, walletId: walletData.walletId, batchedRequests: batchedPaymentRequests });
                //TODO create tx
            }
            //only go into error state if we did not reach max batch size, as otherwise we might have enough funds in other wallets
            if (paymentRequestsRemaining.length > 0 && maxBatchSizeReached == false)
                await Promise.allSettled(paymentRequestsRemaining.map(async (paymentRequest) => {
                    //TODO create tx
                    await prisma.purchaseRequest.update({
                        where: { id: paymentRequest.id }, data: {
                            CurrentStatus: {
                                create: {
                                    status: $Enums.PurchasingRequestStatus.PurchaseInitiated,
                                    timestamp: new Date(),
                                    errorType: "INSUFFICIENT_FUNDS",
                                    errorRequiresManualReview: true,
                                    errorNote: "Not enough funds in wallets",
                                }
                            }
                        }
                    })
                }))
            await Promise.allSettled(walletPairings.map(async (walletPairing) => {
                try {

                    const wallet = walletPairing.wallet;
                    const walletId = walletPairing.walletId;
                    const batchedRequests = walletPairing.batchedRequests;
                    //batch payments
                    const unsignedTx = await new Transaction({ initiator: wallet, }).setMetadata(674, {
                        msg: ["Masumi", "PaymentBatched"],
                    })
                    for (const paymentRequest of batchedRequests) {
                        const buyerVerificationKeyHash = resolvePaymentKeyHash(wallet.getUsedAddress().toBech32())
                        const sellerVerificationKeyHash = paymentRequest.SellerWallet.walletVkey;
                        const submitResultTime = paymentRequest.submitResultTime
                        const unlockTime = paymentRequest.unlockTime
                        const refundTime = paymentRequest.refundTime

                        const datum = {
                            value: {
                                alternative: 0,
                                fields: [
                                    buyerVerificationKeyHash,
                                    sellerVerificationKeyHash,
                                    paymentRequest.blockchainIdentifier,
                                    paymentRequest.CurrentStatus.resultHash ?? '',
                                    submitResultTime,
                                    unlockTime,
                                    refundTime,
                                    //is converted to false
                                    mBool(false),
                                    0,
                                    0,
                                    getSmartContractStateDatum(SmartContractState.FundsLocked)
                                ],
                            },
                            inline: true,
                        };
                        unsignedTx.sendAssets({
                            address: walletPairing.scriptAddress,
                            datum,
                        },
                            paymentRequest.Amounts.map((amount) => ({ unit: amount.unit, quantity: amount.amount.toString() }))
                        )
                    }

                    const purchaseRequests = await Promise.allSettled(batchedRequests.map(async (request) => {
                        await prisma.purchaseRequest.update({
                            where: { id: request.id }, data: {
                                CurrentStatus: {
                                    create: {
                                        status: $Enums.PurchasingRequestStatus.PurchaseInitiated,
                                        timestamp: new Date(),
                                        Transaction: {
                                            create: {
                                                txHash: null,
                                                BlocksWallet: {
                                                    connect: {
                                                        id: walletId
                                                    }
                                                }
                                            }
                                        }
                                    }
                                },
                                SmartContractWallet: {
                                    connect: {
                                        id: walletId
                                    }
                                },
                                StatusHistory: {
                                    connect: {
                                        id: request.CurrentStatus.id
                                    }
                                }
                            }
                        })
                    }))
                    const failedPurchaseRequests = purchaseRequests.filter(x => x.status != "fulfilled")
                    if (failedPurchaseRequests.length > 0) {
                        logger.error("Error updating payment status, before submitting tx ", failedPurchaseRequests);
                        throw new Error("Error updating payment status, before submitting tx ");
                    }

                    const completeTx = await unsignedTx.build();
                    const signedTx = await wallet.signTx(completeTx);
                    //submit the transaction to the blockchain


                    await advancedRetry({
                        operation: async () => {
                            const txHash = await wallet.submitTx(signedTx);
                            //update purchase requests
                            const purchaseRequests = await Promise.allSettled(batchedRequests.map(async (request) => {
                                await prisma.purchaseRequest.update({
                                    where: { id: request.id }, data: {
                                        CurrentStatus: {
                                            update: {
                                                Transaction: {
                                                    update: {
                                                        txHash: txHash
                                                    }
                                                },
                                                status: $Enums.PurchasingRequestStatus.PurchaseInitiated,
                                            }
                                        }
                                    }
                                })
                            }))
                            const failedPurchaseRequests = purchaseRequests.filter(x => x.status != "fulfilled")
                            if (failedPurchaseRequests.length > 0) {
                                throw new Error("Error updating payment status " + failedPurchaseRequests);
                            }
                        },
                        errorResolvers: [delayErrorResolver({
                            configuration: {
                                maxRetries: 3,
                                backoffMultiplier: 2,
                                initialDelayMs: 1000,
                                maxDelayMs: 10000
                            },
                        })],
                        throwOnUnrecoveredError: true
                    });

                } catch (error) {
                    logger.error("Error batching payments", error);
                }
            }))

        }))
    }
    catch (error) {
        logger.error("Error batching payments", error);
    }
    finally {
        //library is strange as we can release from any non-acquired semaphore
        updateMutex.release()
    }
}

export const cardanoPaymentBatcherService = { batchLatestPaymentEntriesV1 }
