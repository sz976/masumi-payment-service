import { payAuthenticatedEndpointFactory } from '@/utils/security/auth/pay-authenticated';
import { z } from 'zod';
import { $Enums } from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import * as cbor from "cbor"
import { cardanoTxHandlerService } from "@/services/cardano-tx-handler"
import { tokenCreditService } from '@/services/token-credit';
import { BlockfrostProvider, mBool, SLOT_CONFIG_NETWORK, Transaction, unixTimeToEnclosingSlot } from '@meshsdk/core';
import { getPaymentScriptFromNetworkHandlerV1 } from '@/utils/generator/contract-generator';
import { DEFAULTS } from '@/utils/config';
import { convertNetwork } from '@/utils/converter/network-convert';
import { generateWalletExtended } from '@/utils/generator/wallet-generator';
import { decodeV1ContractDatum } from '@/services/cardano-tx-handler/cardano-tx-handler.service';
export const queryPurchaseRequestSchemaInput = z.object({
    limit: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of purchases to return"),
    cursorId: z.string().optional().describe("Used to paginate through the purchases. If this is provided, cursorId is required"),
    network: z.nativeEnum($Enums.Network).describe("The network the purchases were made on"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the purchases were made to"),
})

export const queryPurchaseRequestSchemaOutput = z.object({
    purchases: z.array(z.object({
        id: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        status: z.nativeEnum($Enums.PurchasingRequestStatus),
        txHash: z.string().nullable(),
        utxo: z.string().nullable(),
        errorType: z.nativeEnum($Enums.PurchaseRequestErrorType).nullable(),
        errorNote: z.string().nullable(),
        errorRequiresManualReview: z.boolean().nullable(),
        blockchainIdentifier: z.string(),
        SmartContractWallet: z.object({ id: z.string(), walletAddress: z.string(), walletVkey: z.string(), note: z.string().nullable() }).nullable(),
        SellerWallet: z.object({ walletVkey: z.string(), note: z.string().nullable() }).nullable(),
        Amounts: z.array(z.object({ id: z.string(), createdAt: z.date(), updatedAt: z.date(), amount: z.number({ coerce: true }).min(0), unit: z.string() })),
        NetworkHandler: z.object({ id: z.string(), network: z.nativeEnum($Enums.Network), paymentContractAddress: z.string(), paymentType: z.nativeEnum($Enums.PaymentType) }).nullable(),
    }))
});

export const queryPurchaseRequestGet = payAuthenticatedEndpointFactory.build({
    method: "get",
    input: queryPurchaseRequestSchemaInput,
    output: queryPurchaseRequestSchemaOutput,
    handler: async ({ input, logger }) => {
        logger.info("Querying registry");
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkHandler = await prisma.networkHandler.findUnique({ where: { network_paymentContractAddress: { network: input.network, paymentContractAddress: paymentContractAddress } } })
        if (networkHandler == null) {
            throw createHttpError(404, "Network handler not found")
        }
        let cursor = undefined;
        if (input.cursorIdentifierSellingWalletVkey && input.cursorIdentifier) {
            const sellerWallet = await prisma.sellerWallet.findUnique({ where: { networkHandlerId_walletVkey: { networkHandlerId: networkHandler.id, walletVkey: input.cursorIdentifierSellingWalletVkey } } })
            if (sellerWallet == null) {
                throw createHttpError(404, "Selling wallet not found")
            }
            cursor = { id: input.cursorId }
        }

        const result = await prisma.purchaseRequest.findMany({
            where: { networkHandlerId: networkHandler.id },
            cursor: cursor,
            take: input.limit,
            include: {
                SellerWallet: { select: { walletVkey: true, note: true, } },
                SmartContractWallet: { select: { id: true, walletVkey: true, note: true, walletAddress: true } },
                NetworkHandler: true,
                Amounts: true
            }
        })
        if (result == null) {
            throw createHttpError(404, "Purchase not found")
        }
        return { purchases: result.map(purchase => ({ ...purchase, Amounts: purchase.Amounts.map(amount => ({ ...amount, amount: Number(amount.amount) })) })) }
    },
});

export const createPurchaseInitSchemaInput = z.object({
    id: z.string(),
    blockchainIdentifier: z.string().max(250).describe("The identifier of the purchase. Is provided by the seller"),
    network: z.nativeEnum($Enums.Network).describe("The network the transaction will be made on"),
    sellerVkey: z.string().max(250).describe("The verification key of the seller"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the purchase will be made to"),
    amounts: z.array(z.object({ amount: z.number({ coerce: true }).min(0).max(Number.MAX_SAFE_INTEGER), unit: z.string() })).max(7).describe("The amounts of the purchase"),
    paymentType: z.nativeEnum($Enums.PaymentType).describe("The payment type of smart contract used"),
    unlockTime: z.number({ coerce: true }).describe("The time after which the purchase will be unlocked. In unix time (number)"),
    refundTime: z.number({ coerce: true }).describe("The time after which a refund will be approved. In unix time (number)"),
    submitResultTime: z.number({ coerce: true }).describe("The time by which the result has to be submitted. In unix time (number)"),
})

export const createPurchaseInitSchemaOutput = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    status: z.nativeEnum($Enums.PurchasingRequestStatus),
});

export const createPurchaseInitPost = payAuthenticatedEndpointFactory.build({
    method: "post",
    input: createPurchaseInitSchemaInput,
    output: createPurchaseInitSchemaOutput,
    handler: async ({ input, options, logger }) => {
        logger.info("Creating purchase", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkCheckSupported = await prisma.networkHandler.findUnique({ where: { network_paymentContractAddress: { network: input.network, paymentContractAddress: paymentContractAddress } } })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        const wallets = await prisma.purchasingWallet.aggregate({ where: { networkHandlerId: networkCheckSupported.id, }, _count: true })
        if (wallets._count === 0) {
            throw createHttpError(404, "No valid purchasing wallets found")
        }
        //require at least 3 hours between unlock time and the submit result time
        const additionalRefundTime = 1000 * 60 * 60 * 3;
        if (input.unlockTime > input.refundTime + additionalRefundTime) {
            throw createHttpError(400, "Refund request time must be after unlock time with at least 3 hours difference")
        }
        if (input.submitResultTime < Date.now()) {
            throw createHttpError(400, "Submit result time must be in the future")
        }
        const offset = 1000 * 60 * 15;
        if (input.submitResultTime > input.unlockTime + offset) {
            throw createHttpError(400, "Submit result time must be after unlock time with at least 15 minutes difference")
        }
        const initial = await tokenCreditService.handlePurchaseCreditInit(options.id, input.amounts.map(amount => {
            if (amount.unit == "") {
                return { amount: BigInt(amount.amount), unit: "lovelace" }
            } else {
                return { amount: BigInt(amount.amount), unit: amount.unit }
            }
        }), input.network, input.blockchainIdentifier, input.paymentType, paymentContractAddress, input.sellerVkey, input.submitResultTime, input.unlockTime, input.refundTime);
        return initial
    },
});


export const refundPurchaseSchemaInput = z.object({
    id: z.string(),
    blockchainIdentifier: z.string().max(250).describe("The identifier of the purchase to be refunded"),
    network: z.nativeEnum($Enums.Network).describe("The network the Cardano wallet will be used on"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract holding the purchase"),
})

export const refundPurchaseSchemaOutput = z.object({
    txHash: z.string(),
});

export const refundPurchasePatch = payAuthenticatedEndpointFactory.build({
    method: "patch",
    input: refundPurchaseSchemaInput,
    output: refundPurchaseSchemaOutput,
    handler: async ({ input, logger }) => {
        logger.info("Creating purchase", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkCheckSupported = await prisma.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: { network: input.network, paymentContractAddress: paymentContractAddress }
            }, include: {
                FeeReceiverNetworkWallet: true,
                AdminWallets: true,
                PurchaseRequests: {
                    where: {
                        blockchainIdentifier: input.blockchainIdentifier
                    }, include: {
                        SellerWallet: true,
                        SmartContractWallet: {
                            include: { WalletSecret: true }
                        }
                    }
                }
            }
        })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        if (networkCheckSupported.PurchaseRequests.length == 0) {
            throw createHttpError(404, "Purchase not found")
        }
        const purchase = networkCheckSupported.PurchaseRequests[0];
        if (purchase.status != $Enums.PurchasingRequestStatus.RefundConfirmed) {
            throw createHttpError(400, "Purchase in invalid state " + purchase.status)
        }


        const blockchainProvider = new BlockfrostProvider(
            networkCheckSupported.rpcProviderApiKey,
        )



        const { wallet, utxos, address } = await generateWalletExtended(networkCheckSupported.network, networkCheckSupported.rpcProviderApiKey, purchase.SmartContractWallet!.WalletSecret.secret!)

        if (utxos.length === 0) {
            //this is if the buyer wallet is empty
            throw new Error('No UTXOs found in the wallet. Wallet is empty.');
        }

        const { script, smartContractAddress } = await getPaymentScriptFromNetworkHandlerV1(networkCheckSupported)




        const utxoByHash = await blockchainProvider.fetchUTxOs(
            purchase.txHash!,
        );

        const utxo = utxoByHash.find((utxo) => utxo.input.txHash == purchase.txHash);

        if (!utxo) {
            throw new Error('UTXO not found');
        }

        if (!utxo) {
            throw new Error('UTXO not found');
        }

        // Get the datum from the UTXO

        // Decode the CBOR-encoded datum

        const sellerVerificationKeyHash = purchase.SellerWallet.walletVkey;
        const buyerVerificationKeyHash = purchase.SmartContractWallet?.walletVkey;
        if (!buyerVerificationKeyHash)
            throw createHttpError(404, "purchasing wallet not found")

        const utxoDatum = utxo.output.plutusData;
        if (!utxoDatum) {
            throw new Error('No datum found in UTXO');
        }


        const decodedDatum = cbor.decode(Buffer.from(utxoDatum, 'hex'));
        const decodedContract = decodeV1ContractDatum(decodedDatum)
        if (decodedContract == null) {
            throw new Error('Invalid datum');
        }


        const datum = {
            value: {
                alternative: 0,
                fields: [
                    buyerVerificationKeyHash,
                    sellerVerificationKeyHash,
                    purchase.blockchainIdentifier,
                    decodedContract.resultHash,
                    decodedContract.resultTime,
                    decodedContract.unlockTime,
                    decodedContract.refundTime,
                    //is converted to true
                    mBool(true),
                    decodedContract.newCooldownTime,
                    0,
                ],
            },
            inline: true,
        };
        const redeemer = {
            data: {
                alternative: 2,
                fields: [],
            },
        };
        const networkType = convertNetwork(networkCheckSupported.network)
        const invalidBefore =
            unixTimeToEnclosingSlot(Date.now() - 150000, SLOT_CONFIG_NETWORK[networkType]) - 1;
        const invalidHereafter =
            unixTimeToEnclosingSlot(Date.now() + 150000, SLOT_CONFIG_NETWORK[networkType]) + 1;
        //console.log(utxo);

        const unsignedTx = new Transaction({ initiator: wallet }).setMetadata(674, {
            msg: ["Masumi", "RequestRefund"],
        })
            .redeemValue({
                value: utxo,
                script: script,
                redeemer: redeemer,
            })
            .sendValue(
                { address: smartContractAddress, datum: datum },
                utxo,
            )
            .setChangeAddress(address)
            .setRequiredSigners([address]);

        unsignedTx.txBuilder.invalidBefore(invalidBefore);
        unsignedTx.txBuilder.invalidHereafter(invalidHereafter);
        const buildTransaction = await unsignedTx.build();
        const signedTx = await wallet.signTx(buildTransaction);

        //submit the transaction to the blockchain
        const txHash = await wallet.submitTx(signedTx);
        await prisma.purchaseRequest.update({ where: { id: purchase.id }, data: { status: $Enums.PurchasingRequestStatus.RefundRequestInitiated, potentialTxHash: txHash } })

        return { txHash }
    },
});