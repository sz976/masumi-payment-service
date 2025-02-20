import { PurchaseErrorType, PurchasingAction, TransactionStatus } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { BlockfrostProvider, SLOT_CONFIG_NETWORK, Transaction, unixTimeToEnclosingSlot } from "@meshsdk/core";
import { logger } from "@/utils/logger";
import * as cbor from "cbor";
import { getPaymentScriptFromPaymentSourceV1 } from "@/utils/generator/contract-generator";
import { convertNetwork, } from "@/utils/converter/network-convert";
import { generateWalletExtended } from "@/utils/generator/wallet-generator";
import { decodeV1ContractDatum } from "@/utils/converter/string-datum-convert";
import { lockAndQueryPurchases } from "@/utils/db/lock-and-query-purchases";
import { convertErrorString } from "@/utils/converter/error-string-convert";
import { advancedRetryAll, delayErrorResolver } from "advanced-retry";

const updateMutex = new Sema(1);

export async function collectRefundV1() {

    //const maxBatchSize = 10;

    const acquiredMutex = await updateMutex.tryAcquire();
    //if we are already performing an update, we wait for it to finish and return
    if (!acquiredMutex)
        return await updateMutex.acquire();

    try {
        const paymentContractsWithWalletLocked = await lockAndQueryPurchases(
            {
                purchasingAction: PurchasingAction.WithdrawRefundRequested,
                submitResultTime: {
                    lte: Date.now() - 1000 * 60 * 1 //add 1 minutes for block time
                },
            }
        )

        await Promise.allSettled(paymentContractsWithWalletLocked.map(async (paymentContract) => {

            if (paymentContract.PurchaseRequests.length == 0)
                return;

            const network = convertNetwork(paymentContract.network)


            const blockchainProvider = new BlockfrostProvider(paymentContract.PaymentSourceConfig.rpcProviderApiKey, undefined);


            const purchaseRequests = paymentContract.PurchaseRequests;

            if (purchaseRequests.length == 0)
                return;
            const results = await advancedRetryAll({
                errorResolvers: [delayErrorResolver({ configuration: { maxRetries: 5, backoffMultiplier: 5, initialDelayMs: 500, maxDelayMs: 7500 } })],
                operations: purchaseRequests.map((request) => async () => {
                    if (request.SmartContractWallet == null)
                        throw new Error("Smart contract wallet not found");
                    const { wallet, utxos, address } = await generateWalletExtended(paymentContract.network, paymentContract.PaymentSourceConfig.rpcProviderApiKey, request.SmartContractWallet.Secret.encryptedMnemonic)

                    if (utxos.length === 0) {
                        //this is if the seller wallet is empty
                        throw new Error('No UTXOs found in the wallet. Wallet is empty.');
                    }

                    const { script, smartContractAddress } = await getPaymentScriptFromPaymentSourceV1(paymentContract)


                    const txHash = request.CurrentTransaction?.txHash;
                    if (txHash == null) {
                        throw new Error('Transaction hash not found');
                    }

                    const utxoByHash = await blockchainProvider.fetchUTxOs(
                        txHash,
                    );

                    const utxo = utxoByHash.find((utxo) => utxo.input.txHash == txHash);

                    if (!utxo) {
                        throw new Error('UTXO not found');
                    }


                    const utxoDatum = utxo.output.plutusData;
                    if (!utxoDatum) {
                        throw new Error('No datum found in UTXO');
                    }

                    const decodedDatum = cbor.decode(Buffer.from(utxoDatum, 'hex'));
                    const decodedContract = decodeV1ContractDatum(decodedDatum)
                    if (decodedContract == null) {
                        throw new Error('Invalid datum');
                    }


                    const redeemer = {
                        data: {
                            alternative: 3,
                            fields: [],
                        },
                    };
                    const invalidBefore =
                        unixTimeToEnclosingSlot(Date.now() - 150000, SLOT_CONFIG_NETWORK[network]) - 1;

                    const invalidAfter =
                        unixTimeToEnclosingSlot(Date.now() + 150000, SLOT_CONFIG_NETWORK[network]) + 1;

                    const unsignedTx = new Transaction({ initiator: wallet }).setMetadata(674, {
                        msg: ["Masumi", "CollectRefund"],
                    })
                        .redeemValue({
                            value: utxo,
                            script: script,
                            redeemer: redeemer,
                        })
                        .sendAssets(
                            {
                                address: address,
                            },
                            utxo.output.amount
                        )
                        .setChangeAddress(address)
                        .setRequiredSigners([address]);

                    unsignedTx.txBuilder.invalidBefore(invalidBefore);
                    unsignedTx.txBuilder.invalidHereafter(invalidAfter);

                    const buildTransaction = await unsignedTx.build();
                    const signedTx = await wallet.signTx(buildTransaction);
                    await prisma.purchaseRequest.update({
                        where: { id: request.id }, data: {
                            NextAction: {
                                update: {
                                    requestedAction: PurchasingAction.SetRefundRequestedInitiated,
                                    submittedTxHash: null
                                }
                            },
                        }
                    })

                    //submit the transaction to the blockchain
                    const newTxHash = await wallet.submitTx(signedTx);

                    await prisma.purchaseRequest.update({
                        where: { id: request.id }, data: {
                            CurrentTransaction: {
                                update: {
                                    txHash: newTxHash,
                                    status: TransactionStatus.Pending,
                                    BlocksWallet: {
                                        connect: {
                                            id: request.SmartContractWallet.id
                                        }
                                    }
                                }
                            },
                            TransactionHistory: {
                                connect: {
                                    id: request.CurrentTransaction!.id
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
                    return true;
                })
            })
            let index = 0;
            for (const result of results) {
                const request = purchaseRequests[index];
                if (result.success == false || result.result != true) {
                    const error = result.error;
                    logger.error(`Error collecting refund`, { error: error });
                    await prisma.purchaseRequest.update({
                        where: { id: request.id }, data: {
                            NextAction: {
                                update: {
                                    requestedAction: PurchasingAction.WaitingForManualAction,
                                    errorType: PurchaseErrorType.Unknown,
                                    errorNote: "Collecting refund failed: " + convertErrorString(error),
                                }
                            },
                            SmartContractWallet: {
                                update: {
                                    lockedAt: null
                                }
                            }
                        }
                    })
                }
                index++;
            }
        }))

    }
    catch (error) {
        //TODO: Release the locked wallets
        logger.error("Error collecting refund", { error: error })
    }
    finally {
        //library is strange as we can release from any non-acquired semaphore
        updateMutex.release()
    }
}

export const cardanoRefundHandlerService = { collectRefundV1 }
