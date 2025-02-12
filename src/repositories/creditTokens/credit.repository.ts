import { prisma } from '@/utils/db';
import { InsufficientFundsError } from '@/utils/errors/insufficient-funds-error';
import { $Enums, WalletType } from '@prisma/client';

async function handlePurchaseCreditInit({ id, cost, metadata, network, blockchainIdentifier, paymentType, contractAddress, sellerVkey, submitResultTime, unlockTime, refundTime }: { id: string, cost: { amount: bigint, unit: string }[], metadata: string | null | undefined, network: $Enums.Network, blockchainIdentifier: string, paymentType: $Enums.PaymentType, contractAddress: string, sellerVkey: string, submitResultTime: bigint, unlockTime: bigint, refundTime: bigint, }) {
    return await prisma.$transaction(async (transaction) => {
        const result = await transaction.apiKey.findUnique({
            where: { id: id }, include: {
                RemainingUsageCredits: true
            }
        })
        if (!result) {
            throw Error("Invalid id: " + id)
        }


        const remainingAccumulatedUsageCredits: Map<string, bigint> = new Map<string, bigint>();

        // Sum up all purchase amounts
        result.RemainingUsageCredits.forEach(request => {
            if (!remainingAccumulatedUsageCredits.has(request.unit)) {
                remainingAccumulatedUsageCredits.set(request.unit, 0n);
            }
            remainingAccumulatedUsageCredits.set(request.unit, remainingAccumulatedUsageCredits.get(request.unit)! + request.amount);
        });

        const totalCost: Map<string, bigint> = new Map<string, bigint>();
        cost.forEach(amount => {
            if (!totalCost.has(amount.unit)) {
                totalCost.set(amount.unit, 0n);
            }
            totalCost.set(amount.unit, totalCost.get(amount.unit)! + amount.amount);
        });
        const newRemainingUsageCredits: Map<string, bigint> = remainingAccumulatedUsageCredits;

        if (result.usageLimited) {
            for (const [unit, amount] of totalCost) {
                if (!newRemainingUsageCredits.has(unit)) {
                    throw new InsufficientFundsError("Credit unit not found: " + unit + " for id: " + id)
                }
                newRemainingUsageCredits.set(unit, newRemainingUsageCredits.get(unit)! - amount);
                if (newRemainingUsageCredits.get(unit)! < 0) {
                    throw new InsufficientFundsError("Not enough " + unit + " tokens to handleCreditUsage for id: " + id)
                }
            }
        }

        // Create new usage amount records with unique IDs
        const updatedUsageAmounts = Array.from(newRemainingUsageCredits.entries()).map(([unit, amount]) => ({
            id: `${id}-${unit}`, // Create a unique ID
            amount: amount,
            unit: unit
        }));
        if (result.usageLimited) {
            await transaction.apiKey.update({
                where: { id: id },
                data: {
                    RemainingUsageCredits: {
                        set: updatedUsageAmounts
                    },
                }
            })
        }

        const networkHandler = await transaction.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: { network: network, paymentContractAddress: contractAddress },
                paymentType: paymentType
            }
        })
        if (!networkHandler) {
            throw Error("Invalid networkHandler: " + networkHandler)
        }

        const sellerWallet = await transaction.walletBase.findUnique({
            where: {
                networkHandlerId_walletVkey_type: { networkHandlerId: networkHandler.id, walletVkey: sellerVkey, type: WalletType.SELLER }
            }
        })


        const purchaseRequest = await prisma.purchaseRequest.create({
            data: {
                requestedBy: { connect: { id: id } },
                Amounts: {
                    create: Array.from(totalCost.entries()).map(([unit, amount]) => ({
                        amount: amount,
                        unit: unit
                    }))
                },
                submitResultTime: submitResultTime,
                NetworkHandler: { connect: { id: networkHandler.id } },
                SellerWallet: {
                    connectOrCreate: {
                        where: {
                            id: sellerWallet?.id ?? "not-found"
                        },
                        create: { walletVkey: sellerVkey, networkHandlerId: networkHandler.id, type: WalletType.SELLER }
                    }
                },
                blockchainIdentifier: blockchainIdentifier,
                CurrentStatus: {
                    create: {
                        status: $Enums.PurchasingRequestStatus.PurchaseRequested,
                        timestamp: new Date(),
                        requestedBy: { connect: { id: id } }
                    }
                },
                refundTime: refundTime,
                unlockTime: unlockTime,
                metadata: metadata,
            },
            include: {
                SellerWallet: true,
                SmartContractWallet: true,
                NetworkHandler: true,
                Amounts: true,
                CurrentStatus: {
                    include: {
                        Transaction: true
                    }
                },
            }
        })

        return purchaseRequest
    }, { isolationLevel: "ReadCommitted", maxWait: 15000, timeout: 15000 });

}

export const creditTokenRepository = { handlePurchaseCreditInit }