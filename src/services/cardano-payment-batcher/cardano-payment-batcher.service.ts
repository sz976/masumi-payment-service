import { $Enums } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { MeshWallet, Transaction, mBool, resolvePaymentKeyHash } from "@meshsdk/core";
import { logger } from "@/utils/logger";
import { generateWalletExtended } from "@/utils/generator/wallet-generator";
import { delayedRetryErrorResolver, executeWithRetry } from "advanced-retry";


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
                    paymentType: "WEB3_CARDANO_V1",
                    PurchasingWallets: { some: { PendingTransaction: null } }
                }, include: {
                    PurchaseRequests: {
                        where: { status: $Enums.PurchasingRequestStatus.PurchaseRequested, errorType: null, },
                        include: {
                            Amounts: {
                                select: {
                                    amount: true, unit: true
                                }
                            },
                            SellerWallet: {
                                select: {
                                    walletVkey: true
                                }
                            }
                        }
                    },
                    PurchasingWallets: { include: { WalletSecret: true } }
                }
            })
            const purchasingWalletIds: string[] = []
            for (const networkCheck of networkChecks) {
                for (const purchasingWallet of networkCheck.PurchasingWallets) {
                    if (purchasingWallet.id) {
                        purchasingWalletIds.push(purchasingWallet.id)
                    } else {
                        logger.warn("No purchasing wallet found for purchase request", { purchasingWallet: purchasingWallet })
                    }
                }
            }
            for (const purchasingWalletId of purchasingWalletIds) {
                await prisma.purchasingWallet.update({
                    where: { id: purchasingWalletId },
                    data: { PendingTransaction: { create: { hash: null } } }
                })
            }
            return networkChecks;
        }, { isolationLevel: "Serializable" });

        await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {
            const paymentRequests = networkCheck.PurchaseRequests;
            if (paymentRequests.length == 0) {
                logger.info("no payment requests found for network " + networkCheck.network + " " + networkCheck.paymentContractAddress)
                return;
            }

            const potentialWallets = networkCheck.PurchasingWallets;

            const walletAmounts = await Promise.all(potentialWallets.map(async (wallet) => {
                const { wallet: meshWallet, } = await generateWalletExtended(networkCheck.network, networkCheck.rpcProviderApiKey, wallet.WalletSecret.secret!)
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
            const walletPairings: {
                wallet: MeshWallet, scriptAddress: string,
                walletId: string,
                batchedRequests: {
                    submitResultTime: bigint,
                    Amounts: { unit: string, amount: bigint }[], blockchainIdentifier: string, resultHash: string | null, id: string,
                    SellerWallet: { walletVkey: string }, refundTime: bigint, unlockTime: bigint
                }[]
            }[] = [];
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
                        paymentRequest.Amounts.push({ unit: "lovelace", amount: minTransactionCalculation })
                    } else {
                        const result = paymentRequest.Amounts.splice(lovelaceRequired, 1);
                        paymentRequest.Amounts.push({ unit: "lovelace", amount: minTransactionCalculation > result[0].amount ? minTransactionCalculation : result[0].amount })
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
                            errorType: "INSUFFICIENT_FUNDS",
                            errorRequiresManualReview: true,
                            errorNote: "Not enough funds in wallets",
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
                        const correctedPaymentAmounts = paymentRequest.Amounts;
                        const lovelaceIndex = correctedPaymentAmounts.findIndex((amount) => amount.unit.toLowerCase() == "lovelace");
                        /*if (lovelaceIndex != -1) {
                            const removedLovelace = correctedPaymentAmounts.splice(lovelaceIndex, 1);
                            if (removedLovelace[0].amount > minTransactionCalculation) {
                                correctedPaymentAmounts.push({ unit: "lovelace", amount: removedLovelace[0].amount - minTransactionCalculation })
                            }
                        }*/

                        const datum = {
                            value: {
                                alternative: 0,
                                fields: [
                                    buyerVerificationKeyHash,
                                    sellerVerificationKeyHash,
                                    paymentRequest.blockchainIdentifier,
                                    paymentRequest.resultHash ?? '',
                                    submitResultTime,
                                    unlockTime,
                                    refundTime,
                                    //is converted to false
                                    mBool(false),
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
                        await prisma.purchaseRequest.update({ where: { id: request.id }, data: { potentialTxHash: null, status: $Enums.PurchasingRequestStatus.PurchaseInitiated } })
                    }))
                    const failedPurchaseRequests = purchaseRequests.filter(x => x.status != "fulfilled")
                    if (failedPurchaseRequests.length > 0) {
                        logger.error("Error updating payment status, before submitting tx ", failedPurchaseRequests);
                        throw new Error("Error updating payment status, before submitting tx ");
                    }

                    const completeTx = await unsignedTx.build();
                    const signedTx = await wallet.signTx(completeTx);
                    //submit the transaction to the blockchain
                    const txHash = await wallet.submitTx(signedTx);

                    await executeWithRetry({
                        operation: async () => {
                            //update purchase requests
                            const purchaseRequests = await Promise.allSettled(batchedRequests.map(async (request) => {
                                await prisma.purchaseRequest.update({ where: { id: request.id }, data: { SmartContractWallet: { connect: { id: walletId } }, potentialTxHash: txHash, status: $Enums.PurchasingRequestStatus.PurchaseInitiated } })
                            }))
                            await prisma.purchasingWallet.update({ where: { id: walletId }, data: { PendingTransaction: { upsert: { update: { hash: txHash }, create: { hash: txHash } } } } })
                            const failedPurchaseRequests = purchaseRequests.filter(x => x.status != "fulfilled")
                            if (failedPurchaseRequests.length > 0) {
                                throw new Error("Error updating payment status " + failedPurchaseRequests);
                            }
                        },
                        errorResolvers: [delayedRetryErrorResolver({
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
