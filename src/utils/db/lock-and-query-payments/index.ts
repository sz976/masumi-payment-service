import { $Enums, HotWallet } from "@prisma/client";
import { prisma } from "..";

export async function lockAndQueryPayments({ paymentStatus, errorType = null, submitResultTime = undefined, resultHash = undefined, refundTime = undefined, unlockTime = undefined, smartContractWalletPendingTransaction = undefined }: { paymentStatus: $Enums.PaymentRequestStatus | { in: $Enums.PaymentRequestStatus[] }, errorType: $Enums.PaymentRequestErrorType | null, submitResultTime?: { lte: number } | undefined | { gte: number }, resultHash?: string | null | { not: null } | undefined, refundTime?: { lte: number } | undefined | { gte: number }, unlockTime?: { lte: number } | undefined | { gte: number }, smartContractWalletPendingTransaction?: undefined | null | string }) {
    return await prisma.$transaction(async (prisma) => {
        const networkChecks = await prisma.networkHandler.findMany({
            where: {
                paymentType: "WEB3_CARDANO_V1",
                isSyncing: false
            }, include: {
                PaymentRequests: {
                    where: {
                        CurrentStatus: {
                            status: paymentStatus,
                            errorType: errorType,
                            resultHash: resultHash,
                        },
                        submitResultTime: submitResultTime,
                        refundTime: refundTime,
                        unlockTime: unlockTime,
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
                        BuyerWallet: true,
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
        const sellingWallets: HotWallet[] = []

        const newNetworkChecks = []
        for (const networkCheck of networkChecks) {
            const paymentRequests = []
            for (const sellingRequest of networkCheck.PaymentRequests) {
                const wallet = sellingRequest.SmartContractWallet;
                if (wallet && !sellingWallets.some(w => w.id === wallet.id)) {
                    const result = await prisma.hotWallet.update({
                        where: { id: wallet.id },
                        data: { PendingTransaction: { create: { txHash: null } } }
                    })
                    wallet.pendingTransactionId = result.pendingTransactionId
                    sellingWallets.push(wallet)
                    paymentRequests.push(sellingRequest)
                }
            }
            newNetworkChecks.push({ ...networkCheck, PaymentRequests: paymentRequests })
        }
        return newNetworkChecks;
    }, { isolationLevel: "Serializable" });
}

