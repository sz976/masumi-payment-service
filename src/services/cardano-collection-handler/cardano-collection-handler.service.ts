import { $Enums } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { Asset, BlockfrostProvider, Data, SLOT_CONFIG_NETWORK, Transaction, mBool, unixTimeToEnclosingSlot } from "@meshsdk/core";
import { logger } from "@/utils/logger";
import * as cbor from "cbor";
import { getPaymentScriptFromNetworkHandlerV1 } from "@/utils/generator/contract-generator";
import { convertNetwork } from "@/utils/converter/network-convert";
import { generateWalletExtended } from "@/utils/generator/wallet-generator";
import { decodeV1ContractDatum } from "@/utils/converter/string-datum-convert";

const updateMutex = new Sema(1);

export async function collectOutstandingPaymentsV1() {

    //const maxBatchSize = 10;

    const acquiredMutex = await updateMutex.tryAcquire();
    //if we are already performing an update, we wait for it to finish and return
    if (!acquiredMutex)
        return await updateMutex.acquire();

    try {
        const networkChecksWithWalletLocked = await prisma.$transaction(async (prisma) => {
            const networkChecks = await prisma.networkHandler.findMany({
                where: {
                    paymentType: "WEB3_CARDANO_V1",
                }, include: {
                    PaymentRequests: {
                        where: {
                            unlockTime: {
                                gte: Date.now() + 1000 * 60 * 15 //add 15 minutes for block time

                            }
                            , status: "CompletedConfirmed", resultHash: { not: null },
                            errorType: null,
                            SmartContractWallet: {
                                PendingTransaction: null
                            }
                        },
                        include: { BuyerWallet: true, SmartContractWallet: { where: { PendingTransaction: null }, include: { WalletSecret: true } } }
                    },
                    AdminWallets: true,
                    FeeReceiverNetworkWallet: true,
                    CollectionWallet: true
                }
            })
            const sellingWalletIds = networkChecks.map(x => x.PaymentRequests).flat().map(x => x.SmartContractWallet?.id);
            for (const sellingWalletId of sellingWalletIds) {
                await prisma.sellingWallet.update({
                    where: { id: sellingWalletId },
                    data: { PendingTransaction: { create: { hash: null } } }
                })
            }
            return networkChecks;
        }, { isolationLevel: "Serializable" });
        await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {

            if (networkCheck.PaymentRequests.length == 0 || networkCheck.CollectionWallet == null)
                return;

            const network = convertNetwork(networkCheck.network)

            const blockchainProvider = new BlockfrostProvider(networkCheck.rpcProviderApiKey, undefined);

            const paymentRequests = networkCheck.PaymentRequests;

            if (paymentRequests.length == 0)
                return;
            //we can only allow one transaction per wallet
            const deDuplicatedRequests: ({
                BuyerWallet: { id: string; createdAt: Date; updatedAt: Date; walletVkey: string; networkHandlerId: string; note: string | null; } | null;
                SmartContractWallet: ({
                    WalletSecret: { id: string; createdAt: Date; updatedAt: Date; secret: string; };
                } & { id: string; createdAt: Date; updatedAt: Date; walletVkey: string; walletSecretId: string; pendingTransactionId: string | null; networkHandlerId: string; note: string | null; walletAddress: string }) | null;
            } & { id: string; createdAt: Date; updatedAt: Date; lastCheckedAt: Date | null; status: $Enums.PaymentRequestStatus; errorType: $Enums.PaymentRequestErrorType | null; networkHandlerId: string; smartContractWalletId: string | null; buyerWalletId: string | null; blockchainIdentifier: string; resultHash: string | null; submitResultTime: bigint; unlockTime: bigint; refundTime: bigint; utxo: string | null; txHash: string | null; potentialTxHash: string | null; errorRetries: number; errorNote: string | null; errorRequiresManualReview: boolean | null; })[] = []
            for (const request of paymentRequests) {
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
                            alternative: 0,
                            fields: [],
                        },
                    };
                    const invalidBefore =
                        unixTimeToEnclosingSlot(Date.now() - 150000, SLOT_CONFIG_NETWORK[network]) - 1;

                    const invalidAfter =
                        unixTimeToEnclosingSlot(Date.now() + 150000, SLOT_CONFIG_NETWORK[network]) + 1;

                    //TODO calculate remaining assets
                    const remainingAssets: { [key: string]: Asset } = {};
                    const feeAssets: { [key: string]: Asset } = {};
                    for (const assetValue of utxo.output.amount) {
                        const assetKey = assetValue.unit;
                        let minFee = 0;
                        if (assetValue.unit == "lovelace") {
                            minFee = 1435230;
                        }
                        const value = BigInt(assetValue.quantity);
                        const feeValue = BigInt(Math.max(minFee, (Number(value) * networkCheck.feePermille) / 1000));
                        const remainingValue = value - feeValue;
                        const remainingValueAsset: Asset = {
                            unit: assetValue.unit,
                            quantity: remainingValue.toString()
                        };
                        if (BigInt(remainingValueAsset.quantity) > 0) {
                            remainingAssets[assetKey] = remainingValueAsset;
                        } else {
                            delete remainingAssets[assetKey];
                        }
                        const feeValueAsset: Asset = {
                            unit: assetValue.unit,
                            quantity: feeValue.toString()
                        };
                        if (BigInt(feeValueAsset.quantity) > 0) {
                            feeAssets[assetKey] = feeValueAsset;
                        } else {
                            delete feeAssets[assetKey];
                        }
                    }
                    if (networkCheck.CollectionWallet == null) {
                        await prisma.paymentRequest.update({
                            where: { id: request.id }, data: { errorType: "UNKNOWN", errorRequiresManualReview: true, errorNote: "Collection wallet not found" }
                        })
                        throw new Error("Collection wallet not found");
                    }

                    const unsignedTx = new Transaction({ initiator: wallet }).setMetadata(674, {
                        msg: ["Masumi", "Completed"],
                    })
                        .redeemValue({
                            value: utxo,
                            script: script,
                            redeemer: redeemer,
                        })
                        .sendAssets(
                            {
                                address: networkCheck.CollectionWallet.walletAddress,
                            },
                            Object.values(remainingAssets)
                        )
                        .sendAssets(
                            {
                                address: networkCheck.FeeReceiverNetworkWallet.walletAddress,
                            },
                            Object.values(feeAssets)
                        )
                        .setChangeAddress(address)
                        .setRequiredSigners([address]);

                    unsignedTx.txBuilder.invalidBefore(invalidBefore);
                    unsignedTx.txBuilder.invalidHereafter(invalidAfter);

                    const buildTransaction = await unsignedTx.build();
                    const signedTx = await wallet.signTx(buildTransaction);

                    //submit the transaction to the blockchain
                    const txHash = await wallet.submitTx(signedTx);

                    await prisma.paymentRequest.update({
                        where: { id: request.id }, data: {
                            potentialTxHash: txHash, status: $Enums.PaymentRequestStatus.CompletedInitiated
                            , SmartContractWallet: { update: { PendingTransaction: { update: { hash: txHash } } } }
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
                } catch (error) {
                    logger.error(`Error creating collection transaction: ${error}`);
                    if (request.errorRetries == null || request.errorRetries < networkCheck.maxCollectionRetries) {
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

export const cardanoCollectionHandlerService = { collectOutstandingPaymentsV1 }