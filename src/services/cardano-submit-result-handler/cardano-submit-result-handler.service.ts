import { $Enums } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { BlockfrostProvider, Data, SLOT_CONFIG_NETWORK, Transaction, mBool, unixTimeToEnclosingSlot } from "@meshsdk/core";
import { logger } from "@/utils/logger";
import * as cbor from "cbor";
import { getPaymentScriptFromNetworkHandlerV1, getSmartContractStateDatum, SmartContractState } from "@/utils/generator/contract-generator";
import { convertNetwork, } from "@/utils/converter/network-convert";
import { generateWalletExtended } from "@/utils/generator/wallet-generator";
import { decodeV1ContractDatum } from "@/utils/converter/string-datum-convert";
import { lockAndQueryPayments } from "@/utils/db/lock-and-query-payments";

const updateMutex = new Sema(1);

export async function submitResultV1() {

    const acquiredMutex = await updateMutex.tryAcquire();
    //if we are already performing an update, we wait for it to finish and return
    if (!acquiredMutex)
        return await updateMutex.acquire();

    try {
        const networkChecksWithWalletLocked = await lockAndQueryPayments(
            {
                paymentStatus: { in: [$Enums.PaymentRequestStatus.PaymentConfirmed, $Enums.PaymentRequestStatus.RefundRequested] },
                errorType: null,
                submitResultTime: {
                    lte: Date.now() - 1000 * 60 * 1 //remove 1 minute for block time
                },
                resultHash: { not: null },
                smartContractWalletPendingTransaction: null
            }
        )

        await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {

            if (networkCheck.PaymentRequests.length == 0)
                return;

            const network = convertNetwork(networkCheck.network)

            const blockchainProvider = new BlockfrostProvider(networkCheck.NetworkHandlerConfig.rpcProviderApiKey);

            const paymentRequests = networkCheck.PaymentRequests;

            if (paymentRequests.length == 0)
                return;
            //we can only allow one transaction per wallet
            const deDuplicatedRequests: ({ Amounts: { id: string; createdAt: Date; updatedAt: Date; paymentRequestId: string | null; amount: bigint; unit: string; purchaseRequestId: string | null; }[]; BuyerWallet: { id: string; createdAt: Date; updatedAt: Date; walletVkey: string; type: $Enums.WalletType; networkHandlerId: string; note: string | null; } | null; SmartContractWallet: ({ Secret: { id: string; createdAt: Date; updatedAt: Date; secret: string; }; } & { id: string; createdAt: Date; updatedAt: Date; walletVkey: string; walletAddress: string; type: $Enums.HotWalletType; secretId: string; collectionAddress: string | null; pendingTransactionId: string | null; networkHandlerId: string; note: string | null; }) | null; CurrentStatus: { Transaction: { id: string; createdAt: Date; updatedAt: Date; lastCheckedAt: Date | null; txHash: string | null; } | null; } & { id: string; createdAt: Date; updatedAt: Date; timestamp: Date; status: $Enums.PaymentRequestStatus; resultHash: string | null; cooldownTimeSeller: bigint | null; cooldownTimeBuyer: bigint | null; transactionId: string | null; errorType: $Enums.PaymentRequestErrorType | null; errorNote: string | null; errorRequiresManualReview: boolean | null; requestedById: string | null; paymentRequestId: string | null; }; } & { id: string; createdAt: Date; updatedAt: Date; networkHandlerId: string; lastCheckedAt: Date | null; submitResultTime: bigint; refundTime: bigint; unlockTime: bigint; requestedById: string; smartContractWalletId: string | null; buyerWalletId: string | null; currentStatusId: string; blockchainIdentifier: string; })[] = []
            for (const request of paymentRequests) {
                if (request.smartContractWalletId == null)
                    continue;
                if (deDuplicatedRequests.some(r => r.smartContractWalletId == request.smartContractWalletId))
                    continue;

                deDuplicatedRequests.push(request);
            }

            await Promise.allSettled(deDuplicatedRequests.map(async (request) => {
                const { wallet, utxos, address } = await generateWalletExtended(networkCheck.network, networkCheck.NetworkHandlerConfig.rpcProviderApiKey, request.SmartContractWallet!.Secret.secret!)

                if (utxos.length === 0) {
                    //this is if the seller wallet is empty
                    throw new Error('No UTXOs found in the wallet. Wallet is empty.');
                }

                const { script, smartContractAddress } = await getPaymentScriptFromNetworkHandlerV1(networkCheck)
                const txHash = request.CurrentStatus.Transaction?.txHash;
                if (txHash == null) {
                    throw new Error('No transaction hash found');
                }
                const utxoByHash = await blockchainProvider.fetchUTxOs(
                    txHash,
                );

                const utxo = utxoByHash.find((utxo) => utxo.input.txHash == txHash);

                if (!utxo) {
                    throw new Error('UTXO not found');
                }


                const buyerVerificationKeyHash = request.BuyerWallet?.walletVkey;
                const sellerVerificationKeyHash = request.SmartContractWallet!.walletVkey;

                const utxoDatum = utxo.output.plutusData;
                if (!utxoDatum) {
                    throw new Error('No datum found in UTXO');
                }

                const decodedDatum = cbor.decode(Buffer.from(utxoDatum, 'hex'));
                const decodedContract = decodeV1ContractDatum(decodedDatum)
                if (decodedContract == null) {
                    throw new Error('Invalid datum');
                }

                const datum = {
                    value: {
                        alternative: 0,
                        fields: [
                            buyerVerificationKeyHash,
                            sellerVerificationKeyHash,
                            request.blockchainIdentifier,
                            request.CurrentStatus.resultHash,
                            decodedContract.resultTime,
                            decodedContract.unlockTime,
                            decodedContract.refundTime,
                            //is converted to false
                            mBool(decodedContract.refundRequested),
                            decodedContract.newCooldownTime,
                            0,
                            getSmartContractStateDatum(decodedContract.refundRequested ? SmartContractState.Disputed : SmartContractState.ResultSubmitted),
                        ],
                    } as Data,
                    inline: true,
                };

                const redeemer = {
                    data: {
                        alternative: 5,
                        fields: [],
                    },
                };
                const invalidBefore =
                    unixTimeToEnclosingSlot(Date.now() - 150000, SLOT_CONFIG_NETWORK[network]) - 1;

                const invalidAfter =
                    unixTimeToEnclosingSlot(Date.now() + 150000, SLOT_CONFIG_NETWORK[network]) + 1;

                const unsignedTx = new Transaction({ initiator: wallet }).setMetadata(674, {
                    msg: ["Masumi", "SubmitResult"],
                })
                    .redeemValue({
                        value: utxo,
                        script: script,
                        redeemer: redeemer,
                    })
                    .sendAssets(
                        {
                            address: smartContractAddress,
                            datum: datum,
                        },
                        utxo.output.amount
                    )
                    //send to remaining amount the original purchasing wallet
                    .setChangeAddress(address)
                    .setRequiredSigners([address]);

                unsignedTx.txBuilder.invalidBefore(invalidBefore);
                unsignedTx.txBuilder.invalidHereafter(invalidAfter);

                const buildTransaction = await unsignedTx.build();
                const signedTx = await wallet.signTx(buildTransaction);

                await prisma.paymentRequest.update({
                    where: { id: request.id }, data: {
                        CurrentStatus: {
                            create: {
                                timestamp: new Date(),
                                Transaction: {
                                    create: {
                                        txHash: null,
                                        BlocksWallet: {
                                            connect: {
                                                id: request.SmartContractWallet!.id
                                            }
                                        }
                                    }
                                },
                                status: $Enums.PaymentRequestStatus.CompletedInitiated,
                            }
                        },
                    }
                })
                //submit the transaction to the blockchain
                const newTxHash = await wallet.submitTx(signedTx);
                await prisma.paymentRequest.update({
                    where: { id: request.id }, data: {
                        CurrentStatus: {
                            update: {
                                Transaction: {
                                    update: {
                                        txHash: newTxHash
                                    }
                                }
                            }
                        }
                    }
                })

                logger.info(`Created withdrawal transaction:
                  Tx ID: ${txHash}
                  View (after a bit) on https://${network === 'preprod'
                        ? 'preprod.'
                        : ''
                    }cardanoscan.io/transaction/${txHash}
                  Smart Contract Address: ${smartContractAddress}
              `);

            }))
        }))

    }
    finally {
        //library is strange as we can release from any non-acquired semaphore
        updateMutex.release()
    }
}

export const cardanoSubmitResultHandlerService = { submitResultV1 }
