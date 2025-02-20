import { HotWallet, HotWalletType, PaymentType, RegistrationState } from "@prisma/client";
import { prisma } from "../index.js";

export async function lockAndQueryRegistryRequests({ state }: { state: RegistrationState }) {
    return await prisma.$transaction(async (prisma) => {
        const paymentSources = await prisma.paymentSource.findMany({
            where: {
                paymentType: PaymentType.Web3CardanoV1,
                syncInProgress: false
            }, include: {
                RegistryRequest: {
                    where: {
                        state: state
                    },
                    include: {
                        SmartContractWallet: {
                            include: {
                                Secret: true
                            }
                        },
                        Pricing: true,
                    }
                },
                HotWallets: {
                    include: {
                        Secret: true
                    },
                    where: {
                        type: HotWalletType.Selling,
                        PendingTransaction: null,
                        lockedAt: null
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
            const registryRequests = []
            for (const registryRequest of paymentSource.RegistryRequest) {
                const wallet = registryRequest.SmartContractWallet;
                const availableSellingWallets = paymentSource.HotWallets.filter(w => w.lockedAt == null && w.type == HotWalletType.Selling && !sellingWallets.some(w => w.id === w.id))
                if (wallet && wallet.lockedAt == null && !sellingWallets.some(w => w.id === wallet.id)) {
                    const result = await prisma.hotWallet.update({
                        where: { id: wallet.id },
                        data: { lockedAt: new Date() }
                    })
                    wallet.pendingTransactionId = result.pendingTransactionId
                    sellingWallets.push(wallet)
                    registryRequests.push(registryRequest)
                } else if (!wallet && availableSellingWallets.length != 0) {
                    const walletToUse = availableSellingWallets[0]
                    const result = await prisma.hotWallet.update({
                        where: { id: walletToUse.id },
                        data: { lockedAt: new Date() }
                    })
                    walletToUse.pendingTransactionId = result.pendingTransactionId
                    sellingWallets.push(walletToUse)
                    registryRequest.SmartContractWallet = walletToUse
                    registryRequests.push(registryRequest)
                }
            }
            if (registryRequests.length > 0) {
                newPaymentSources.push({ ...paymentSource, RegistryRequests: registryRequests })
            }
        }
        return newPaymentSources;
    }, { isolationLevel: "Serializable" });
}

