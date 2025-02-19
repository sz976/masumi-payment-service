import { HotWalletType } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { BlockfrostProvider } from "@meshsdk/core";
import { logger } from "@/utils/logger";
import { cardanoRefundHandlerService } from "../cardano-refund-handler/cardano-collection-refund.service";
import { cardanoSubmitResultHandlerService } from "../cardano-submit-result-handler/cardano-submit-result-handler.service";
import { cardanoTimeoutRefundHandlerService } from "../cardano-request-refund-handler/cardano-request-refund-handler.service";
import { cardanoCollectionHandlerService } from "../cardano-collection-handler";
import { cardanoPaymentBatcherService } from "../cardano-payment-batcher";

const updateMutex = new Sema(1);

export async function updateWalletTransactionHash() {

    const acquiredMutex = await updateMutex.tryAcquire();
    //if we are already performing an update, we wait for it to finish and return
    if (!acquiredMutex)
        return await updateMutex.acquire();

    try {

        const lockedHotWallets = await prisma.hotWallet.findMany({
            where: {
                PendingTransaction: {
                    //if the transaction has been checked in the last 30 seconds, we skip it
                    lastCheckedAt: { lte: new Date(Date.now() - 1000 * 30) }
                }
            },
            include: {
                PendingTransaction: true,
                PaymentSource: {
                    include: { PaymentSourceConfig: true }
                }
            },

        });
        let unlockedSellingWallets = 0;
        let unlockedPurchasingWallets = 0;

        await Promise.allSettled(lockedHotWallets.map(async (wallet) => {
            try {
                if (wallet.PendingTransaction == null) {
                    logger.warn(`Wallet ${wallet.id} has no pending transaction. Skipping...`)
                    return;
                }
                const txHash = wallet.PendingTransaction.txHash;

                const blockfrostKey = wallet.PaymentSource.PaymentSourceConfig.rpcProviderApiKey;
                const provider = new BlockfrostProvider(blockfrostKey);
                const txInfo = await provider.fetchTxInfo(txHash);
                if (txInfo) {
                    await prisma.hotWallet.update({
                        where: { id: wallet.id },
                        data: {
                            PendingTransaction: { disconnect: true, },
                            lockedAt: null
                        }
                    });

                    if (wallet.type == HotWalletType.Selling) {
                        unlockedSellingWallets++;
                    } else if (wallet.type == HotWalletType.Purchasing) {
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
                lockedAt: { lt: new Date(Date.now() - 1000 * 60 * 15) }
            },
            include: { PendingTransaction: true, PaymentSource: { include: { PaymentSourceConfig: true } } }
        })
        await Promise.allSettled(timedOutLockedHotWallets.map(async (wallet) => {
            try {
                if (wallet.PendingTransaction == null) {
                    logger.error(`Wallet ${wallet.id} has no pending transaction. Skipping...`)
                    return;
                }

                await prisma.transaction.update({
                    where: { id: wallet.PendingTransaction.id },
                    data: {
                        BlocksWallet: { disconnect: true },
                    }
                })
                if (wallet.type == HotWalletType.Selling) {
                    unlockedSellingWallets++;
                } else if (wallet.type == HotWalletType.Purchasing) {
                    unlockedPurchasingWallets++;
                }
            } catch (error) {
                logger.error(`Error updating timed out wallet: ${error}`);
            }
        }));
        //TODO: reset initialized actions
        if (unlockedPurchasingWallets > 0) {
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

    }
    catch (error) {
        logger.error(`Error updating wallet transaction hash`, { error: error })
    }
    finally {
        //library is strange as we can release from any non-acquired semaphore
        updateMutex.release()
    }
}

export const updateWalletTransactionHashHandlerService = { updateWalletTransactionHash }