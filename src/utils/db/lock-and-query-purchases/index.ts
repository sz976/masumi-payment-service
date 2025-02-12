import { $Enums, HotWallet, } from "@prisma/client";
import { prisma } from "..";
import { logger } from "@/utils/logger";

export async function lockAndQueryPurchases({ purchasingStatus, unlockTime, smartContractWalletPendingTransaction = undefined, resultHash = undefined, submitResultTime = undefined, refundTime = undefined, errorType = null }: { purchasingStatus: $Enums.PurchasingRequestStatus, unlockTime?: { lte: number } | undefined | { gte: number }, smartContractWalletPendingTransaction?: undefined | null | string, resultHash?: string | null | undefined, submitResultTime?: { lte: number } | undefined | { gte: number }, refundTime?: { lte: number } | undefined | { gte: number }, errorType?: $Enums.PurchaseRequestErrorType | null }) {
    return await prisma.$transaction(async (prisma) => {
        try {
            const networkChecks = await prisma.networkHandler.findMany({
                where: {
                    paymentType: "WEB3_CARDANO_V1",
                    isSyncing: false
                }, include: {
                    PurchaseRequests: {
                        where: {
                            submitResultTime: submitResultTime,
                            refundTime: refundTime,
                            unlockTime: unlockTime,
                            CurrentStatus: {
                                status: purchasingStatus,
                                errorType: errorType,
                                resultHash: resultHash,
                            },
                            SmartContractWallet: {
                                PendingTransaction: smartContractWalletPendingTransaction != null && smartContractWalletPendingTransaction != undefined ? {
                                    txHash: smartContractWalletPendingTransaction
                                } : smartContractWalletPendingTransaction
                            }
                        },
                        include: {
                            CurrentStatus: {
                                include: {
                                    Transaction: true
                                }
                            },
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
                    NetworkHandlerConfig: true
                }
            })
            const purchasingWallets: HotWallet[] = []
            const newNetworkChecks = []
            for (const networkCheck of networkChecks) {
                const purchasingRequests = []
                for (const purchasingRequest of networkCheck.PurchaseRequests) {
                    const wallet = purchasingRequest.SmartContractWallet;
                    if (wallet && !purchasingWallets.some(w => w.id === wallet.id)) {
                        const result = await prisma.hotWallet.update({
                            where: { id: wallet.id },
                            data: { PendingTransaction: { create: { txHash: null } } }
                        })
                        wallet.pendingTransactionId = result.pendingTransactionId
                        purchasingWallets.push(wallet)
                        purchasingRequests.push(purchasingRequest)
                    }
                }
                newNetworkChecks.push({ ...networkCheck, PurchaseRequests: purchasingRequests })
            }

            return newNetworkChecks;
        } catch (error) {
            logger.error("Error locking and querying purchases", error);
            throw error;
        }
    }, { isolationLevel: "Serializable" });
}

