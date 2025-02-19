import { HotWalletType, OnChainState, PurchaseErrorType, PurchasingAction, TransactionStatus, WalletType } from "@prisma/client";
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
                refundTime: {
                    gte: Date.now() + 1000 * 60 * 15 //add 15 minutes for block time
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
            //we can only allow one transaction per wallet
            const deDuplicatedRequests: ({ NextAction: { id: string; createdAt: Date; updatedAt: Date; requestedAction: PurchasingAction; submittedTxHash: string | null; errorType: PurchaseErrorType | null; errorNote: string | null; }; CurrentTransaction: { id: string; createdAt: Date; updatedAt: Date; lastCheckedAt: Date | null; txHash: string; status: TransactionStatus; paymentRequestHistoryId: string | null; purchaseRequestHistoryId: string | null; } | null; Amounts: { id: string; createdAt: Date; updatedAt: Date; amount: bigint; unit: string; paymentRequestId: string | null; purchaseRequestId: string | null; }[]; SellerWallet: { id: string; createdAt: Date; updatedAt: Date; walletVkey: string; type: WalletType; paymentSourceId: string; note: string | null; }; SmartContractWallet: ({ Secret: { id: string; createdAt: Date; updatedAt: Date; encryptedMnemonic: string; }; } & { id: string; createdAt: Date; updatedAt: Date; walletVkey: string; walletAddress: string; type: HotWalletType; secretId: string; collectionAddress: string | null; pendingTransactionId: string | null; paymentSourceId: string; lockedAt: Date | null; note: string | null; }) | null; } & { id: string; createdAt: Date; updatedAt: Date; paymentSourceId: string; lastCheckedAt: Date | null; submitResultTime: bigint; refundTime: bigint; unlockTime: bigint; resultHash: string; sellerWalletId: string; smartContractWalletId: string | null; metadata: string | null; blockchainIdentifier: string; onChainState: OnChainState | null; sellerCoolDownTime: bigint; buyerCoolDownTime: bigint; nextActionId: string; requestedById: string; currentTransactionId: string | null; })[] = []

            for (const request of purchaseRequests) {
                if (request.smartContractWalletId == null)
                    continue;
                if (deDuplicatedRequests.some(r => r.smartContractWalletId == request.smartContractWalletId))
                    continue;
                deDuplicatedRequests.push(request);
            }

            await Promise.allSettled(deDuplicatedRequests.map(async (request) => {

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

            }))
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
