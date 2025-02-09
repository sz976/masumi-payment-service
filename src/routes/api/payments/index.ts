import { readAuthenticatedEndpointFactory } from '@/utils/security/auth/read-authenticated';
import { z } from 'zod';
import { $Enums, } from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { ez } from 'express-zod-api';
import cuid2 from '@paralleldrive/cuid2';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { resolvePaymentKeyHash } from '@meshsdk/core';
import { getRegistryScriptV1 } from '@/utils/generator/contract-generator';
import { DEFAULTS } from '@/utils/config';


export const queryPaymentsSchemaInput = z.object({
    limit: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of payments to return"),
    cursorId: z.string().optional().describe("Used to paginate through the payments. If this is provided, cursorId is required"),
    network: z.nativeEnum($Enums.Network).describe("The network the payments were made on"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the payments were made to"),
})

export const queryPaymentsSchemaOutput = z.object({
    payments: z.array(z.object({
        id: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        status: z.nativeEnum($Enums.PaymentRequestStatus),
        txHash: z.string().nullable(),
        utxo: z.string().nullable(),
        errorType: z.nativeEnum($Enums.PaymentRequestErrorType).nullable(),
        errorNote: z.string().nullable(),
        errorRequiresManualReview: z.boolean().nullable(),
        blockchainIdentifier: z.string(),
        SmartContractWallet: z.object({ id: z.string(), walletAddress: z.string(), walletVkey: z.string(), note: z.string().nullable() }).nullable(),
        BuyerWallet: z.object({ walletVkey: z.string(), }).nullable(),
        Amounts: z.array(z.object({ id: z.string(), createdAt: z.date(), updatedAt: z.date(), amount: z.number({ coerce: true }).min(0), unit: z.string() })),
        NetworkHandler: z.object({ id: z.string(), network: z.nativeEnum($Enums.Network), paymentContractAddress: z.string(), paymentType: z.nativeEnum($Enums.PaymentType) }),
    }))
});

export const queryPaymentEntryGet = readAuthenticatedEndpointFactory.build({
    method: "get",
    input: queryPaymentsSchemaInput,
    output: queryPaymentsSchemaOutput,
    handler: async ({ input, logger }) => {
        logger.info("Querying db");
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)

        const networkHandler = await prisma.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: {
                    network: input.network, paymentContractAddress: paymentContractAddress

                }
            }, include: { SellingWallets: true, CollectionWallet: true }
        })
        if (!networkHandler) {
            throw createHttpError(404, "Network handler not found")
        }

        const result = await prisma.paymentRequest.findMany({
            where: { networkHandlerId: networkHandler.id },
            orderBy: { createdAt: "desc" },
            cursor: input.cursorId ? {
                id: input.cursorId
            } : undefined,
            take: input.limit,
            include: {
                BuyerWallet: true,
                SmartContractWallet: true,
                NetworkHandler: true,
                Amounts: true
            }
        })
        if (result == null) {
            throw createHttpError(404, "Payment not found")
        }

        return { payments: result.map(payment => ({ ...payment, Amounts: payment.Amounts.map(amount => ({ ...amount, amount: Number(amount.amount) })) })) }
    },
});


export const createPaymentsSchemaInput = z.object({
    network: z.nativeEnum($Enums.Network).describe("The network the payment will be received on"),
    agentIdentifier: z.string().min(15).max(250).describe("The identifier of the agent that will be paid"),
    amounts: z.array(z.object({ amount: z.number({ coerce: true }).min(0).max(Number.MAX_SAFE_INTEGER), unit: z.string() })).max(7).describe("The amounts of the payment"),
    paymentType: z.nativeEnum($Enums.PaymentType).describe("The type of payment contract used"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the payment will be made to"),
    submitResultTime: ez.dateIn().default(new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString()).describe("The time after which the payment has to be submitted to the smart contract"),
    unlockTime: ez.dateIn().optional().describe("The time after which the payment will be unlocked"),
    refundTime: ez.dateIn().optional().describe("The time after which a refund will be approved"),
})

export const createPaymentSchemaOutput = z.object({
    createdAt: z.date(),
    updatedAt: z.date(),
    status: z.nativeEnum($Enums.PaymentRequestStatus),
    txHash: z.string().nullable(),
    utxo: z.string().nullable(),
    errorType: z.nativeEnum($Enums.PaymentRequestErrorType).nullable(),
    errorNote: z.string().nullable(),
    errorRequiresManualReview: z.boolean().nullable(),
    blockchainIdentifier: z.string(),
    unlockTime: z.number(),
    refundTime: z.number(),
    submitResultTime: z.number(),
    Amounts: z.array(z.object({ id: z.string(), createdAt: z.date(), updatedAt: z.date(), amount: z.number({ coerce: true }).min(0), unit: z.string() })),
    SmartContractWallet: z.object({ id: z.string(), walletAddress: z.string(), walletVkey: z.string(), note: z.string().nullable() }),
    BuyerWallet: z.object({ walletVkey: z.string(), }).nullable(),
    NetworkHandler: z.object({ id: z.string(), network: z.nativeEnum($Enums.Network), paymentContractAddress: z.string(), paymentType: z.nativeEnum($Enums.PaymentType) }),
});

export const paymentInitPost = readAuthenticatedEndpointFactory.build({
    method: "post",
    input: createPaymentsSchemaInput,
    output: createPaymentSchemaOutput,
    handler: async ({ input, logger }) => {
        logger.info("Creating purchase", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkCheckSupported = await prisma.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: {
                    network: input.network,
                    paymentContractAddress: paymentContractAddress
                }
            }, include: { SellingWallets: true, CollectionWallet: true }
        })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        const unlockTime = input.unlockTime != undefined ? input.unlockTime.getTime() : new Date(Date.now() + 1000 * 60 * 60 * 12).getTime() // 12h
        const refundTime = input.refundTime != undefined ? input.refundTime.getTime() : new Date(Date.now() + 1000 * 60 * 60 * 24).getTime() // 24 h

        const provider = new BlockFrostAPI({
            projectId: networkCheckSupported.rpcProviderApiKey
        })
        const { policyId } = await getRegistryScriptV1(paymentContractAddress, input.network)
        const assetId = input.agentIdentifier;
        const policyAsset = assetId.startsWith(policyId) ? assetId : policyId + assetId;
        const assetInWallet = await provider.assetsAddresses(policyAsset, { order: "desc", count: 1 })
        if (assetInWallet.length == 0) {
            throw createHttpError(404, "Agent identifier not found")
        }
        const vKey = resolvePaymentKeyHash(assetInWallet[0].address)


        const sellingWallet = networkCheckSupported.SellingWallets.find(wallet => wallet.walletVkey == vKey)
        if (sellingWallet == null) {
            throw createHttpError(404, "Agent identifier not found in wallet")
        }

        const payment = await prisma.paymentRequest.create({
            data: {
                blockchainIdentifier: input.agentIdentifier + "_" + cuid2.createId(),
                NetworkHandler: { connect: { id: networkCheckSupported.id } },
                Amounts: {
                    createMany: {
                        data: input.amounts.map(amount => {
                            if (amount.unit == "") {
                                return { amount: amount.amount, unit: "lovelace" }
                            } else {
                                return { amount: amount.amount, unit: amount.unit }
                            }
                        })
                    }
                },
                status: $Enums.PaymentRequestStatus.PaymentRequested,
                submitResultTime: input.submitResultTime.getTime(),
                SmartContractWallet: { connect: { id: sellingWallet.id } },
                unlockTime: unlockTime,
                refundTime: refundTime,
            },
            include: { Amounts: true, BuyerWallet: true, SmartContractWallet: true, NetworkHandler: true }
        })
        if (payment.SmartContractWallet == null) {
            throw createHttpError(500, "Smart contract wallet not connected")
        }
        return { ...payment, unlockTime: parseInt(payment.unlockTime.toString()), refundTime: parseInt(payment.refundTime.toString()), submitResultTime: parseInt(payment.submitResultTime.toString()), SmartContractWallet: payment.SmartContractWallet!, Amounts: payment.Amounts.map(amount => ({ ...amount, amount: Number(amount.amount) })) }
    },
});

export const updatePaymentsSchemaInput = z.object({
    network: z.nativeEnum($Enums.Network).describe("The network the payment was received on"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the payment was made to"),
    hash: z.string().max(250).describe("The hash of the AI agent result to be submitted"),
    identifier: z.string().max(250).describe("The identifier of the payment"),
})

export const updatePaymentSchemaOutput = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    status: z.nativeEnum($Enums.PaymentRequestStatus),
});

export const paymentUpdatePatch = readAuthenticatedEndpointFactory.build({
    method: "patch",
    input: updatePaymentsSchemaInput,
    output: updatePaymentSchemaOutput,
    handler: async ({ input, logger }) => {
        logger.info("Creating purchase", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkCheckSupported = await prisma.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: {
                    network: input.network, paymentContractAddress: paymentContractAddress
                }
            }, include: { SellingWallets: true, CollectionWallet: true, PaymentRequests: { where: { blockchainIdentifier: input.blockchainIdentifier } } }
        })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        if (networkCheckSupported.PaymentRequests.length == 0) {
            throw createHttpError(404, "Payment not found")
        }
        if (networkCheckSupported.PaymentRequests[0].status != $Enums.PaymentRequestStatus.PaymentConfirmed) {
            throw createHttpError(400, "Payment in invalid state " + networkCheckSupported.PaymentRequests[0].status)
        }
        //TODO collect the payment
        const payment = await prisma.paymentRequest.update({
            where: { id: networkCheckSupported.PaymentRequests[0].id },
            data: {
                resultHash: input.hash,
            }
        })
        return payment
    },
});