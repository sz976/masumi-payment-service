import { $Enums, SellingWallet } from "@prisma/client";
import { prisma } from "..";

export async function lockAndQueryPayments({ paymentStatus, errorType = null, submitResultTime = undefined, resultHash = undefined, refundTime = undefined, unlockTime = undefined, smartContractWalletPendingTransaction = undefined }: { paymentStatus: $Enums.PaymentRequestStatus | { in: $Enums.PaymentRequestStatus[] }, errorType: $Enums.PaymentRequestErrorType | null, submitResultTime?: { lte: number } | undefined | { gte: number }, resultHash?: string | null | { not: null } | undefined, refundTime?: { lte: number } | undefined | { gte: number }, unlockTime?: { lte: number } | undefined | { gte: number }, smartContractWalletPendingTransaction?: undefined | null | { hash: string } }) {
    return await prisma.$transaction(async (prisma) => {
        const networkChecks = await prisma.networkHandler.findMany({
            where: {
                paymentType: "WEB3_CARDANO_V1",
                SellingWallets: { some: { PendingTransaction: null } },
                isSyncing: false
            }, include: {
                PaymentRequests: {
                    where: {
                        status: paymentStatus,
                        errorType: errorType,
                        submitResultTime: submitResultTime,
                        resultHash: resultHash,
                        refundTime: refundTime,
                        unlockTime: unlockTime,
                        SmartContractWallet: smartContractWalletPendingTransaction !== undefined ? { PendingTransaction: smartContractWalletPendingTransaction } : undefined
                    },
                    include: {
                        Amounts: true,
                        BuyerWallet: true,
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
                SellingWallets: { include: { WalletSecret: true }, where: { PendingTransaction: null } }
            }
        })
        const sellingWallets: SellingWallet[] = []
        for (const networkCheck of networkChecks) {
            for (const sellingWallet of networkCheck.SellingWallets) {
                if (sellingWallet.id && !sellingWallets.some(w => w.id === sellingWallet.id)) {
                    sellingWallets.push(sellingWallet)
                }
            }
        }
        for (const sellingWallet of sellingWallets) {
            const result = await prisma.sellingWallet.update({
                where: { id: sellingWallet.id },
                data: { PendingTransaction: { create: { hash: null } } }
            })
            sellingWallet.pendingTransactionId = result.pendingTransactionId
        }
        return networkChecks;
    }, { isolationLevel: "Serializable" });
}

