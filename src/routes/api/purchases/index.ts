
import { z } from 'zod';
import { HotWalletType, Network, PaymentType, PurchasingAction, TransactionStatus, PurchaseErrorType, OnChainState } from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { tokenCreditService } from '@/services/token-credit';
import { DEFAULTS } from '@/utils/config';
import { payAuthenticatedEndpointFactory } from '@/utils/security/auth/pay-authenticated';
import { checkIsAllowedNetworkOrThrowUnauthorized } from '@/utils/middleware/auth-middleware';

export const queryPurchaseRequestSchemaInput = z.object({
    limit: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of purchases to return"),
    cursorId: z.string().optional().describe("Used to paginate through the purchases. If this is provided, cursorId is required"),
    network: z.nativeEnum(Network).describe("The network the purchases were made on"),
    smartContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the purchases were made to"),
    includeHistory: z.string().optional().transform(val => val?.toLowerCase() == "true").default("false").describe("Whether to include the full transaction and status history of the purchases")
})

export const queryPurchaseRequestSchemaOutput = z.object({
    purchases: z.array(z.object({
        id: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        blockchainIdentifier: z.string(),
        lastCheckedAt: z.date().nullable(),
        submitResultTime: z.string(),
        unlockTime: z.string(),
        refundTime: z.string(),
        requestedById: z.string(),
        onChainState: z.nativeEnum(OnChainState).nullable(),
        resultHash: z.string(),
        NextAction: z.object({
            requestedAction: z.nativeEnum(PurchasingAction),
            errorType: z.nativeEnum(PurchaseErrorType).nullable(),
            errorNote: z.string().nullable(),
        }),
        CurrentTransaction: z.object({
            id: z.string(),
            createdAt: z.date(),
            updatedAt: z.date(),
            txHash: z.string(),
            status: z.nativeEnum(TransactionStatus)
        }).nullable(),
        TransactionHistory: z.array(z.object({
            id: z.string(),
            createdAt: z.date(),
            updatedAt: z.date(),
            txHash: z.string(),
            status: z.nativeEnum(TransactionStatus)
        })),
        Amounts: z.array(z.object({
            id: z.string(),
            createdAt: z.date(),
            updatedAt: z.date(),
            amount: z.string(),
            unit: z.string()
        })),
        PaymentSource: z.object({
            id: z.string(),
            network: z.nativeEnum(Network),
            smartContractAddress: z.string(),
            paymentType: z.nativeEnum(PaymentType)
        }),
        SellerWallet: z.object({
            id: z.string(),
            walletVkey: z.string(),
        }).nullable(),
        SmartContractWallet: z.object({
            id: z.string(),
            walletVkey: z.string(),
            walletAddress: z.string(),
        }).nullable(),
        metadata: z.string().nullable(),
    }))
});

export const queryPurchaseRequestGet = payAuthenticatedEndpointFactory.build({
    method: "get",
    input: queryPurchaseRequestSchemaInput,
    output: queryPurchaseRequestSchemaOutput,
    handler: async ({ input, options }) => {
        const paymentContractAddress = input.smartContractAddress ?? (input.network == Network.Mainnet ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const paymentSource = await prisma.paymentSource.findUnique({
            where: { network_smartContractAddress: { network: input.network, smartContractAddress: paymentContractAddress } }, include: {
                PurchaseRequests: {
                    where: { blockchainIdentifier: input.blockchainIdentifier },

                },
            }
        });
        if (paymentSource == null) {
            throw createHttpError(404, "Payment source not found")
        }
        await checkIsAllowedNetworkOrThrowUnauthorized(options.networkLimit, input.network, options.permission)
        let cursor = undefined;
        if (input.cursorIdentifierSellingWalletVkey && input.cursorIdentifier) {
            const sellerWallet = await prisma.hotWallet.findUnique({ where: { paymentSourceId_walletVkey: { paymentSourceId: paymentSource.id, walletVkey: input.cursorIdentifierSellingWalletVkey, }, type: HotWalletType.Selling } })
            if (sellerWallet == null) {
                throw createHttpError(404, "Selling wallet not found")
            }
            cursor = { id: input.cursorId }
        }

        const result = await prisma.purchaseRequest.findMany({
            where: { paymentSourceId: paymentSource.id },
            cursor: cursor,
            take: input.limit,
            include: {
                SellerWallet: true,
                SmartContractWallet: true,
                Amounts: true,
                NextAction: true,
                PaymentSource: true,
                CurrentTransaction: true,
                TransactionHistory: {
                    orderBy: { createdAt: 'desc', },
                    take: (input.includeHistory == true ? undefined : 0)
                }
            }
        })
        if (result == null) {
            throw createHttpError(404, "Purchase not found")
        }
        return {
            purchases: result.map(purchase => ({
                ...purchase,
                Amounts: purchase.Amounts.map(amount => ({
                    ...amount,
                    amount: amount.amount.toString()
                })),
                submitResultTime: purchase.submitResultTime.toString(),
                unlockTime: purchase.unlockTime.toString(),
                refundTime: purchase.refundTime.toString()
            }))
        }
    },
});

export const createPurchaseInitSchemaInput = z.object({
    blockchainIdentifier: z.string().max(250).describe("The identifier of the purchase. Is provided by the seller"),
    network: z.nativeEnum(Network).describe("The network the transaction will be made on"),
    sellerVkey: z.string().max(250).describe("The verification key of the seller"),
    smartContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the purchase will be made to"),
    amounts: z.array(z.object({ amount: z.string(), unit: z.string() })).max(7).describe("The amounts of the purchase"),
    paymentType: z.nativeEnum(PaymentType).describe("The payment type of smart contract used"),
    unlockTime: z.string().describe("The time after which the purchase will be unlocked. In unix time (number)"),
    refundTime: z.string().describe("The time after which a refund will be approved. In unix time (number)"),
    submitResultTime: z.string().describe("The time by which the result has to be submitted. In unix time (number)"),
    metadata: z.string().optional().describe("Metadata to be stored with the purchase request"),
})

export const createPurchaseInitSchemaOutput = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    blockchainIdentifier: z.string(),
    lastCheckedAt: z.date().nullable(),
    submitResultTime: z.string(),
    unlockTime: z.string(),
    refundTime: z.string(),
    requestedById: z.string(),
    resultHash: z.string(),
    onChainState: z.nativeEnum(OnChainState).nullable(),
    NextAction: z.object({
        requestedAction: z.nativeEnum(PurchasingAction),
        errorType: z.nativeEnum(PurchaseErrorType).nullable(),
        errorNote: z.string().nullable(),
    }),
    CurrentTransaction: z.object({
        id: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        txHash: z.string(),
        status: z.nativeEnum(TransactionStatus)
    }).nullable(),
    Amounts: z.array(z.object({
        id: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        amount: z.string(),
        unit: z.string()
    })),
    PaymentSource: z.object({
        id: z.string(),
        network: z.nativeEnum(Network),
        smartContractAddress: z.string(),
        paymentType: z.nativeEnum(PaymentType)
    }),
    SellerWallet: z.object({
        id: z.string(),
        walletVkey: z.string(),
    }).nullable(),
    SmartContractWallet: z.object({
        id: z.string(),
        walletVkey: z.string(),
        walletAddress: z.string(),
    }).nullable(),
    metadata: z.string().nullable(),
});

export const createPurchaseInitPost = payAuthenticatedEndpointFactory.build({
    method: "post",
    input: createPurchaseInitSchemaInput,
    output: createPurchaseInitSchemaOutput,
    handler: async ({ input, options }) => {
        const smartContractAddress = input.smartContractAddress ?? (input.network == Network.Mainnet ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const paymentSource = await prisma.paymentSource.findUnique({
            where: {
                network_smartContractAddress: {
                    network: input.network, smartContractAddress: smartContractAddress,
                }
            }, include: { PaymentSourceConfig: true, }
        })
        if (paymentSource == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        await checkIsAllowedNetworkOrThrowUnauthorized(options.networkLimit, input.network, options.permission)
        const wallets = await prisma.hotWallet.aggregate({ where: { paymentSourceId: paymentSource.id, type: HotWalletType.Selling }, _count: true })
        if (wallets._count === 0) {
            throw createHttpError(404, "No valid purchasing wallets found")
        }
        //require at least 3 hours between unlock time and the submit result time
        const additionalRefundTime = BigInt(1000 * 60 * 15);
        const submitResultTime = BigInt(input.submitResultTime);
        const unlockTime = BigInt(input.unlockTime);
        const refundTime = BigInt(input.refundTime);
        if (refundTime < unlockTime + additionalRefundTime) {
            throw createHttpError(400, "Refund request time must be after unlock time with at least 15 minutes difference")
        }
        if (submitResultTime < BigInt(Date.now() + 1000 * 60 * 15)) {
            throw createHttpError(400, "Submit result time must be in the future (min. 15 minutes)")
        }
        const offset = BigInt(1000 * 60 * 15);
        if (submitResultTime > unlockTime - offset) {
            throw createHttpError(400, "Submit result time must be before unlock time with at least 15 minutes difference")
        }
        const initialPurchaseRequest = await tokenCreditService.handlePurchaseCreditInit({
            id: options.id, cost: input.amounts.map(amount => {
                if (amount.unit == "") {
                    return { amount: BigInt(amount.amount), unit: "lovelace" }
                } else {
                    return { amount: BigInt(amount.amount), unit: amount.unit }
                }
            }), metadata: input.metadata, network: input.network,
            blockchainIdentifier: input.blockchainIdentifier, paymentType: input.paymentType, contractAddress: smartContractAddress, sellerVkey: input.sellerVkey, submitResultTime: submitResultTime, unlockTime: unlockTime, refundTime: refundTime
        });

        return {
            ...initialPurchaseRequest,
            Amounts: initialPurchaseRequest.Amounts.map(amount => ({
                ...amount,
                amount: amount.amount.toString()
            })),
            submitResultTime: initialPurchaseRequest.submitResultTime.toString(),
            unlockTime: initialPurchaseRequest.unlockTime.toString(),
            refundTime: initialPurchaseRequest.refundTime.toString()
        }
    },
});

