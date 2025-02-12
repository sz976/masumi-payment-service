import { $Enums } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { BlockfrostProvider } from "@meshsdk/core";
import { logger } from "@/utils/logger";
import { cardanoRefundHandlerService } from "../cardano-refund-handler/cardano-collection-refund.service";
import { cardanoSubmitResultHandlerService } from "../cardano-submit-result-handler/cardano-submit-result-handler.service";
import { cardanoTimeoutRefundHandlerService } from "../cardano-collect-timeout-refund-handler/cardano-collect-timeout-refund-handler.service";
import { cardanoCollectionHandlerService } from "../cardano-collection-handler";
import { cardanoPaymentBatcherService } from "../cardano-payment-batcher";

const updateMutex = new Sema(1);

export async function updateWalletTransactionHash() {

    const acquiredMutex = await updateMutex.tryAcquire();
    //if we are already performing an update, we wait for it to finish and return
    if (!acquiredMutex)
        return await updateMutex.acquire();

    try {
        const outdatedTransactions = await prisma.transaction.findMany({
            where: {
                BlocksWallet: null,
                PaymentRequestStatusData: { none: {} },
                PurchaseRequestStatusData: { none: {} }
            },
            include: {
                BlocksWallet: true,
                PaymentRequestStatusData: true,
                PurchaseRequestStatusData: true
            }
        })
        await Promise.allSettled(outdatedTransactions.map(async (transaction) => {
            if (transaction.PaymentRequestStatusData.length > 0 || transaction.PurchaseRequestStatusData.length > 0 || transaction.BlocksWallet != null) {
                logger.error(`Transaction ${transaction.id} is not outdated, but scheduled for deletion. Skipping...`)
                return;
            }
            await prisma.transaction.delete({
                where: { id: transaction.id }
            })
        }))

        const lockedHotWallets = await prisma.hotWallet.findMany({
            where: {
                PendingTransaction: {
                    txHash: { not: null, },
                    //if the transaction has been checked in the last 30 seconds, we skip it
                    lastCheckedAt: { lte: new Date(Date.now() - 1000 * 30) }
                }
            },
            include: { PendingTransaction: true, NetworkHandler: { include: { NetworkHandlerConfig: true } } },

        });
        let unlockedSellingWallets = 0;
        let unlockedPurchasingWallets = 0;

        await Promise.allSettled(lockedHotWallets.map(async (wallet) => {
            try {
                if (wallet.PendingTransaction == null) {
                    logger.error(`Wallet ${wallet.id} has no pending transaction. Skipping...`)
                    return;
                }
                const txHash = wallet.PendingTransaction.txHash;
                if (txHash == null) {
                    logger.error(`Wallet ${wallet.id} has no transaction hash. Skipping...`)
                    return;
                }

                const blockfrostKey = wallet.NetworkHandler.NetworkHandlerConfig.rpcProviderApiKey;
                const provider = new BlockfrostProvider(blockfrostKey);
                const txInfo = await provider.fetchTxInfo(txHash);
                if (txInfo) {
                    await prisma.hotWallet.update({
                        where: { id: wallet.id },
                        data: { PendingTransaction: { disconnect: true } }
                    });

                    if (wallet.type == $Enums.HotWalletType.SELLING) {
                        unlockedSellingWallets++;
                    } else if (wallet.type == $Enums.HotWalletType.PURCHASING) {
                        unlockedPurchasingWallets++;
                    }

                } else {
                    await prisma.transaction.update({
                        where: { id: wallet.PendingTransaction.id },
                        data: { lastCheckedAt: new Date() }
                    });
                }
            } catch (error) {
                logger.error(`Error updating wallet transaction hash: ${error}`);
            }

        }));

        const timedOutLockedHotWallets = await prisma.hotWallet.findMany({
            where: {
                PendingTransaction: {
                    updatedAt: {
                        //wallets that have not been updated in the last 5 minutes
                        lt: new Date(Date.now() - 1000 * 60 * 5)
                    }
                }
            },
            include: { PendingTransaction: true, NetworkHandler: { include: { NetworkHandlerConfig: true } } }
        })
        await Promise.allSettled(timedOutLockedHotWallets.map(async (wallet) => {
            try {

                await prisma.transaction.update({
                    where: { id: wallet.PendingTransaction?.id },
                    data: {
                        BlocksWallet: { disconnect: true },
                        PaymentRequestStatusData: {
                            updateMany: {
                                where: {
                                }, data: { errorRequiresManualReview: true, errorNote: "Transaction timeout", errorType: $Enums.PaymentRequestErrorType.UNKNOWN }
                            }
                        },
                        PurchaseRequestStatusData: { updateMany: { where: {}, data: { errorRequiresManualReview: true, errorNote: "Transaction timeout", errorType: $Enums.PaymentRequestErrorType.UNKNOWN } } },
                    }
                })
                if (wallet.type == $Enums.HotWalletType.SELLING) {
                    unlockedSellingWallets++;
                } else if (wallet.type == $Enums.HotWalletType.PURCHASING) {
                    unlockedPurchasingWallets++;
                }
            } catch (error) {
                logger.error(`Error updating timed out wallet: ${error}`);
            }

        }));
        if (unlockedPurchasingWallets > 0) {
            //TODO run all possible services that can profit from a wallet unlock
            try {
                await cardanoSubmitResultHandlerService.submitResultV1()
            } catch (error) {
                logger.error(`Error initiating refunds: ${error}`);
            }
            try {
                await cardanoPaymentBatcherService.batchLatestPaymentEntriesV1()
            } catch (error) {
                logger.error(`Error initiating refunds: ${error}`);
            }
            try {
                await cardanoCollectionHandlerService.collectOutstandingPaymentsV1()
            } catch (error) {
                logger.error(`Error initiating refunds: ${error}`);
            }
        }
        if (unlockedSellingWallets > 0) {
            //TODO run all possible services that can profit from a wallet unlock
            try {
                await cardanoRefundHandlerService.collectRefundV1()
            } catch (error) {
                logger.error(`Error initiating timeout refunds: ${error}`);
            }
            try {
                await cardanoTimeoutRefundHandlerService.collectTimeoutRefundsV1()
            } catch (error) {
                logger.error(`Error initiating timeout refunds: ${error}`);
            }
        }

    } finally {
        //library is strange as we can release from any non-acquired semaphore
        updateMutex.release()
    }
}

export const updateWalletTransactionHashHandlerService = { updateWalletTransactionHash }