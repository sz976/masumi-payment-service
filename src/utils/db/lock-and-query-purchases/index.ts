import { $Enums, PurchasingWallet } from "@prisma/client";
import { prisma } from "..";

export async function lockAndQueryPurchases({ purchasingStatus, unlockTime, smartContractWalletPendingTransaction = undefined, resultHash = undefined, submitResultTime = undefined, refundTime = undefined, errorType = null }: { purchasingStatus: $Enums.PurchasingRequestStatus, unlockTime?: { lte: number } | undefined | { gte: number }, smartContractWalletPendingTransaction?: undefined | null | { hash: string }, resultHash?: string | null | undefined, submitResultTime?: { lte: number } | undefined | { gte: number }, refundTime?: { lte: number } | undefined | { gte: number }, errorType?: $Enums.PurchaseRequestErrorType | null }) {
    return await prisma.$transaction(async (prisma) => {
        const networkChecks = await prisma.networkHandler.findMany({
            where: {
                paymentType: "WEB3_CARDANO_V1",
                PurchasingWallets: { some: { PendingTransaction: null } },
                isSyncing: false
            }, include: {
                PurchaseRequests: {
                    where: {
                        status: purchasingStatus,
                        errorType: errorType,
                        submitResultTime: submitResultTime,
                        resultHash: resultHash,
                        refundTime: refundTime,
                        unlockTime: unlockTime,
                        SmartContractWallet: smartContractWalletPendingTransaction !== undefined ? { PendingTransaction: smartContractWalletPendingTransaction } : undefined
                    },
                    include: {
                        Amounts: true,
                        SellerWallet: true,
                        SmartContractWallet: {
                            include: {
                                WalletSecret: true
                            }
                        }
                    }
                },
                AdminWallets: true,
                CollectionWallet: true,
                FeeReceiverNetworkWallet: true,
                PurchasingWallets: { include: { WalletSecret: true }, where: { PendingTransaction: null } }
            }
        })
        const purchasingWallets: PurchasingWallet[] = []
        for (const networkCheck of networkChecks) {
            for (const purchasingWallet of networkCheck.PurchasingWallets) {
                if (purchasingWallet.id && !purchasingWallets.some(w => w.id === purchasingWallet.id)) {
                    purchasingWallets.push(purchasingWallet)
                }
            }
        }

        for (const purchasingWallet of purchasingWallets) {
            const result = await prisma.purchasingWallet.update({
                where: { id: purchasingWallet.id },
                data: { PendingTransaction: { create: { hash: null } } }
            })
            purchasingWallet.pendingTransactionId = result.pendingTransactionId
        }
        return networkChecks;
    }, { isolationLevel: "Serializable" });
}

