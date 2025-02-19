import { HotWallet, PaymentType, PurchasingAction } from "@prisma/client";
import { prisma } from "..";
import { logger } from "@/utils/logger";

export async function lockAndQueryPurchases({ purchasingAction, unlockTime, resultHash = undefined, submitResultTime = undefined, refundTime = undefined, }: { purchasingAction: PurchasingAction, unlockTime?: { lte: number } | undefined | { gte: number }, smartContractWalletPendingTransaction?: undefined | null | string, resultHash?: string | undefined, submitResultTime?: { lte: number } | undefined | { gte: number }, refundTime?: { lte: number } | undefined | { gte: number }, }) {
    return await prisma.$transaction(async (prisma) => {
        try {
            const paymentSources = await prisma.paymentSource.findMany({
                where: {
                    paymentType: PaymentType.Web3CardanoV1,
                    syncInProgress: false
                }, include: {
                    PurchaseRequests: {
                        where: {
                            submitResultTime: submitResultTime,
                            refundTime: refundTime,
                            unlockTime: unlockTime,
                            NextAction: {
                                requestedAction: purchasingAction,
                                errorType: null,
                            },
                            resultHash: resultHash,
                            SmartContractWallet: {
                                PendingTransaction: { is: null },
                                lockedAt: null
                            },
                            buyerCoolDownTime: { lte: Date.now() },
                        },
                        include: {
                            NextAction: true,
                            CurrentTransaction: true,
                            Amounts: true,
                            SellerWallet: true,
                            SmartContractWallet: {
                                include: {
                                    Secret: true
                                }
                            }
                        }
                    },
                    AdminWallets: true,
                    FeeReceiverNetworkWallet: true,
                    PaymentSourceConfig: true
                }
            })
            const purchasingWallets: HotWallet[] = []
            const newPaymentSources = []
            for (const paymentSource of paymentSources) {
                const purchasingRequests = []
                const minCooldownTime = paymentSource.cooldownTime;
                for (const purchasingRequest of paymentSource.PurchaseRequests) {
                    if (purchasingRequest.buyerCoolDownTime > Date.now() - minCooldownTime) {
                        continue;
                    }
                    const wallet = purchasingRequest.SmartContractWallet;
                    if (wallet && !purchasingWallets.some(w => w.id === wallet.id)) {
                        const result = await prisma.hotWallet.update({
                            where: { id: wallet.id },
                            data: { lockedAt: new Date() }
                        })
                        wallet.pendingTransactionId = result.pendingTransactionId
                        purchasingWallets.push(wallet)
                        purchasingRequests.push(purchasingRequest)
                    }
                }
                newPaymentSources.push({ ...paymentSource, PurchaseRequests: purchasingRequests })
            }
            return newPaymentSources;
        } catch (error) {
            logger.error("Error locking and querying purchases", error);
            throw error;
        }
    }, { isolationLevel: "Serializable" });
}

