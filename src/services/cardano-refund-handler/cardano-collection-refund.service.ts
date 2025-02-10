import { $Enums } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { BlockfrostProvider, SLOT_CONFIG_NETWORK, Transaction, unixTimeToEnclosingSlot } from "@meshsdk/core";
import { logger } from "@/utils/logger";
import * as cbor from "cbor";
import { getPaymentScriptFromNetworkHandlerV1 } from "@/utils/generator/contract-generator";
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
        const networkChecksWithWalletLocked = await lockAndQueryPurchases(
            {
                purchasingStatus: $Enums.PurchasingRequestStatus.RefundRequestConfirmed,
                errorType: null,
                refundTime: {
                    gte: Date.now() + 1000 * 60 * 15 //add 15 minutes for block time
                },
                resultHash: null,
                smartContractWalletPendingTransaction: null
            }
        )

        await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {

            if (networkCheck.PurchaseRequests.length == 0 || networkCheck.CollectionWallet == null)
                return;

            const network = convertNetwork(networkCheck.network)


            const blockchainProvider = new BlockfrostProvider(networkCheck.rpcProviderApiKey, undefined);


            const purchaseRequests = networkCheck.PurchaseRequests;

            if (purchaseRequests.length == 0)
                return;
            //we can only allow one transaction per wallet
            const deDuplicatedRequests: ({
                SmartContractWallet: ({
                    WalletSecret: {
                        id: string; createdAt: Date; updatedAt: Date; secret: string;
                    };
                } & {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    walletVkey: string;
                    walletSecretId: string; pendingTransactionId: string | null;
                    walletAddress: string;
                    networkHandlerId: string;
                    note: string | null;
                }) | null;
            } & {
                id: string;
                createdAt: Date; updatedAt: Date;
                lastCheckedAt: Date | null;
                status: $Enums.PurchasingRequestStatus;
                resultHash: string | null; errorType: $Enums.PurchaseRequestErrorType | null;
                networkHandlerId: string;
                sellerWalletId: string;
                smartContractWalletId: string | null; blockchainIdentifier: string; submitResultTime: bigint; unlockTime: bigint; refundTime: bigint; utxo: string | null; txHash: string | null; potentialTxHash: string | null; errorRetries: number; errorNote: string | null; errorRequiresManualReview: boolean | null; triggeredById: string;
            })[] = []
            for (const request of purchaseRequests) {
                if (request.smartContractWalletId == null)
                    continue;
                if (deDuplicatedRequests.some(r => r.smartContractWalletId == request.smartContractWalletId))
                    continue;
                deDuplicatedRequests.push(request);
            }

            await Promise.allSettled(deDuplicatedRequests.map(async (request) => {
                try {
                    const { wallet, utxos, address } = await generateWalletExtended(networkCheck.network, networkCheck.rpcProviderApiKey, request.SmartContractWallet!.WalletSecret.secret!)

                    if (utxos.length === 0) {
                        //this is if the seller wallet is empty
                        throw new Error('No UTXOs found in the wallet. Wallet is empty.');
                    }

                    const { script, smartContractAddress } = await getPaymentScriptFromNetworkHandlerV1(networkCheck)




                    const utxoByHash = await blockchainProvider.fetchUTxOs(
                        request.txHash!,
                    );

                    const utxo = utxoByHash.find((utxo) => utxo.input.txHash == request.txHash);

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

                    //submit the transaction to the blockchain
                    const txHash = await wallet.submitTx(signedTx);

                    await prisma.purchaseRequest.update({
                        where: { id: request.id }, data: { potentialTxHash: txHash, status: $Enums.PurchasingRequestStatus.RefundInitiated, SmartContractWallet: { update: { PendingTransaction: { create: { hash: txHash } } } } }
                    })

                    logger.info(`Created withdrawal transaction:
                  Tx ID: ${txHash}
                  View (after a bit) on https://${network === 'preprod'
                            ? 'preprod.'
                            : ''
                        }cardanoscan.io/transaction/${txHash}
                  Smart Contract Address: ${smartContractAddress}
              `);
                } catch (error) {
                    logger.error(`Error creating refund transaction: ${error}`);
                    if (request.errorRetries == null || request.errorRetries < networkCheck.maxRefundRetries) {
                        await prisma.paymentRequest.update({
                            where: { id: request.id }, data: { errorRetries: { increment: 1 } }
                        })
                    } else {
                        const errorMessage = "Error creating refund transaction: " + (error instanceof Error ? error.message :
                            (typeof error === 'object' && error ? error.toString() : "Unknown Error"));
                        await prisma.paymentRequest.update({
                            where: { id: request.id },
                            data: {
                                errorType: "UNKNOWN",
                                errorRequiresManualReview: true,
                                errorNote: errorMessage
                            }
                        })
                    }
                }
            }))
        }))

    }
    finally {
        //library is strange as we can release from any non-acquired semaphore
        updateMutex.release()
    }
}

export const cardanoRefundHandlerService = { collectRefundV1 }
