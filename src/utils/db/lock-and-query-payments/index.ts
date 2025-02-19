import { HotWallet, PaymentAction, PaymentType } from "@prisma/client";
import { prisma } from "..";

export async function lockAndQueryPayments({ paymentStatus, submitResultTime = undefined, resultHash = undefined, refundTime = undefined, unlockTime = undefined }: { paymentStatus: PaymentAction | { in: PaymentAction[] }, submitResultTime?: { lte: number } | undefined | { gte: number }, resultHash?: string | { not: null } | undefined, refundTime?: { lte: number } | undefined | { gte: number }, unlockTime?: { lte: number } | undefined | { gte: number }, smartContractWalletPendingTransaction?: undefined | null | string }) {
    return await prisma.$transaction(async (prisma) => {

        const paymentSources = await prisma.paymentSource.findMany({
            where: {
                paymentType: PaymentType.Web3CardanoV1,
                syncInProgress: false
            }, include: {
                PaymentRequests: {
                    where: {
                        NextAction: {
                            requestedAction: paymentStatus,
                            errorType: null,
                            resultHash: resultHash
                        },
                        submitResultTime: submitResultTime,
                        refundTime: refundTime,
                        unlockTime: unlockTime,
                        SmartContractWallet: {
                            PendingTransaction: { is: null },
                            lockedAt: null
                        },
                        sellerCoolDownTime: { lte: Date.now() },
                    },
                    include: {
                        NextAction: true,
                        CurrentTransaction: true,
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
                PaymentSourceConfig: true
            }
        })
        const sellingWallets: HotWallet[] = []

        const newPaymentSources = []
        for (const paymentSource of paymentSources) {
            const paymentRequests = []
            const minCooldownTime = paymentSource.cooldownTime;
            for (const paymentRequest of paymentSource.PaymentRequests) {
                if (paymentRequest.sellerCoolDownTime > Date.now() - minCooldownTime) {
                    continue;
                }

                const wallet = paymentRequest.SmartContractWallet;
                if (wallet && !sellingWallets.some(w => w.id === wallet.id)) {
                    const result = await prisma.hotWallet.update({
                        where: { id: wallet.id },
                        data: { lockedAt: new Date() }
                    })
                    wallet.pendingTransactionId = result.pendingTransactionId
                    sellingWallets.push(wallet)

                    paymentRequests.push(paymentRequest)
                }
            }
            newPaymentSources.push({ ...paymentSource, PaymentRequests: paymentRequests })
        }
        return newPaymentSources;
    }, { isolationLevel: "Serializable" });
}

