import { payAuthenticatedEndpointFactory } from '@/utils/security/auth/pay-authenticated';
import { z } from 'zod';
import { $Enums, HotWalletType } from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import * as cbor from "cbor"
import { tokenCreditService } from '@/services/token-credit';
import { BlockfrostProvider, mBool, SLOT_CONFIG_NETWORK, Transaction, unixTimeToEnclosingSlot } from '@meshsdk/core';
import { getPaymentScriptFromNetworkHandlerV1, getSmartContractStateDatum, SmartContractState } from '@/utils/generator/contract-generator';
import { DEFAULTS } from '@/utils/config';
import { convertNetwork } from '@/utils/converter/network-convert';
import { generateWalletExtended } from '@/utils/generator/wallet-generator';
import { decodeV1ContractDatum } from '@/utils/converter/string-datum-convert';
export const queryPurchaseRequestSchemaInput = z.object({
    limit: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of purchases to return"),
    cursorId: z.string().optional().describe("Used to paginate through the purchases. If this is provided, cursorId is required"),
    network: z.nativeEnum($Enums.Network).describe("The network the purchases were made on"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the purchases were made to"),
    includeHistory: z.boolean().optional().default(false).describe("Whether to include the full transaction and status history of the purchases")
})

export const queryPurchaseRequestSchemaOutput = z.object({
    purchases: z.array(z.object({
        id: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        blockchainIdentifier: z.string(),
        lastCheckedAt: z.date().nullable(),
        networkHandlerId: z.string(),
        smartContractWalletId: z.string().nullable(),
        sellerWalletId: z.string().nullable(),
        submitResultTime: z.string(),
        unlockTime: z.string(),
        refundTime: z.string(),
        requestedById: z.string(),
        CurrentStatus: z.object({
            status: z.nativeEnum($Enums.PurchasingRequestStatus),
            Transaction: z.object({
                txHash: z.string().nullable(),
            }).nullable(),
            errorType: z.nativeEnum($Enums.PurchaseRequestErrorType).nullable(),
            errorNote: z.string().nullable(),
            errorRequiresManualReview: z.boolean().nullable(),
        }),
        StatusHistory: z.array(z.object({
            status: z.nativeEnum($Enums.PurchasingRequestStatus),
            Transaction: z.object({
                txHash: z.string().nullable(),
            }).nullable(),
            errorType: z.nativeEnum($Enums.PurchaseRequestErrorType).nullable(),
            errorNote: z.string().nullable(),
            errorRequiresManualReview: z.boolean().nullable(),
        })),
        Amounts: z.array(z.object({
            id: z.string(),
            createdAt: z.date(),
            updatedAt: z.date(),
            amount: z.string(),
            unit: z.string()
        })),
        NetworkHandler: z.object({
            id: z.string(),
            network: z.nativeEnum($Enums.Network),
            paymentContractAddress: z.string(),
            paymentType: z.nativeEnum($Enums.PaymentType)
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
    handler: async ({ input, logger }) => {
        logger.info("Querying registry");
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkHandler = await prisma.networkHandler.findUnique({
            where: { network_paymentContractAddress: { network: input.network, paymentContractAddress: paymentContractAddress } }, include: {
                PurchaseRequests: {
                    where: { blockchainIdentifier: input.blockchainIdentifier },

                },
            }
        });
        if (networkHandler == null) {
            throw createHttpError(404, "Network handler not found")
        }
        let cursor = undefined;
        if (input.cursorIdentifierSellingWalletVkey && input.cursorIdentifier) {
            const sellerWallet = await prisma.hotWallet.findUnique({ where: { networkHandlerId_walletVkey: { networkHandlerId: networkHandler.id, walletVkey: input.cursorIdentifierSellingWalletVkey, }, type: HotWalletType.SELLING } })
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
                SellerWallet: true,
                SmartContractWallet: true,
                NetworkHandler: true,
                Amounts: true,
                CurrentStatus: {
                    include: {
                        Transaction: true
                    }
                },
                StatusHistory: { orderBy: { timestamp: 'desc', }, take: input.includeHistory ? undefined : 0, include: { Transaction: true } }
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
    network: z.nativeEnum($Enums.Network).describe("The network the transaction will be made on"),
    sellerVkey: z.string().max(250).describe("The verification key of the seller"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the purchase will be made to"),
    amounts: z.array(z.object({ amount: z.string(), unit: z.string() })).max(7).describe("The amounts of the purchase"),
    paymentType: z.nativeEnum($Enums.PaymentType).describe("The payment type of smart contract used"),
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
    networkHandlerId: z.string(),
    smartContractWalletId: z.string().nullable(),
    sellerWalletId: z.string().nullable(),
    submitResultTime: z.string(),
    unlockTime: z.string(),
    refundTime: z.string(),
    requestedById: z.string(),
    CurrentStatus: z.object({
        status: z.nativeEnum($Enums.PurchasingRequestStatus),
        Transaction: z.object({
            txHash: z.string().nullable(),
        }).nullable(),
        errorType: z.nativeEnum($Enums.PurchaseRequestErrorType).nullable(),
        errorNote: z.string().nullable(),
        errorRequiresManualReview: z.boolean().nullable(),
    }),
    Amounts: z.array(z.object({
        id: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        amount: z.string(),
        unit: z.string()
    })),
    NetworkHandler: z.object({
        id: z.string(),
        network: z.nativeEnum($Enums.Network),
        paymentContractAddress: z.string(),
        paymentType: z.nativeEnum($Enums.PaymentType)
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
    handler: async ({ input, options, logger }) => {
        logger.info("Creating purchase", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkCheckSupported = await prisma.networkHandler.findUnique({ where: { network_paymentContractAddress: { network: input.network, paymentContractAddress: paymentContractAddress } } })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        const wallets = await prisma.hotWallet.aggregate({ where: { networkHandlerId: networkCheckSupported.id, type: HotWalletType.SELLING }, _count: true })
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
            }), metadata: input.metadata, network: input.network, blockchainIdentifier: input.blockchainIdentifier, paymentType: input.paymentType, contractAddress: paymentContractAddress, sellerVkey: input.sellerVkey, submitResultTime: submitResultTime, unlockTime: unlockTime, refundTime: refundTime
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
    handler: async ({ input, options, logger }) => {
        logger.info("Creating purchase", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkCheckSupported = await prisma.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: { network: input.network, paymentContractAddress: paymentContractAddress }
            }, include: {
                FeeReceiverNetworkWallet: true,
                AdminWallets: true,
                NetworkHandlerConfig: true,
                PurchaseRequests: {
                    where: {
                        blockchainIdentifier: input.blockchainIdentifier
                    }, include: {
                        SellerWallet: true,
                        SmartContractWallet: true,
                        CurrentStatus: {
                            include: {
                                Transaction: true
                            }
                        },
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

        if (purchase.CurrentStatus.status != $Enums.PurchasingRequestStatus.RefundConfirmed) {
            throw createHttpError(400, "Purchase in invalid state " + purchase.CurrentStatus.status)
        }

        if (purchase.CurrentStatus.Transaction == null) {
            throw createHttpError(400, "Purchase in invalid state")
        }
        if (purchase.CurrentStatus.Transaction.txHash == null) {
            throw createHttpError(400, "Purchase in invalid state")
        }


        const blockchainProvider = new BlockfrostProvider(
            networkCheckSupported.NetworkHandlerConfig.rpcProviderApiKey,
        )


        const { wallet, utxos, address } = await generateWalletExtended(networkCheckSupported.network, networkCheckSupported.NetworkHandlerConfig.rpcProviderApiKey, purchase.SmartContractWallet!.secretId)

        if (utxos.length === 0) {
            //this is if the buyer wallet is empty
            throw new Error('No UTXOs found in the wallet. Wallet is empty.');
        }

        const { script, smartContractAddress } = await getPaymentScriptFromNetworkHandlerV1(networkCheckSupported)

        const utxoByHash = await blockchainProvider.fetchUTxOs(
            purchase.CurrentStatus.Transaction.txHash,
        );

        const utxo = utxoByHash.find((utxo) => utxo.input.txHash == purchase.CurrentStatus.Transaction!.txHash);

        if (!utxo) {
            throw new Error('UTXO not found');
        }

        if (!utxo) {
            throw new Error('UTXO not found');
        }


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
                    getSmartContractStateDatum(decodedContract.resultHash == "" ? SmartContractState.RefundRequested : SmartContractState.Disputed),
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
        await prisma.purchaseRequest.update({
            where: { id: purchase.id }, data: {
                CurrentStatus: {
                    create: {
                        status: $Enums.PurchasingRequestStatus.RefundRequestInitiated,
                        timestamp: new Date(),
                        requestedBy: { connect: { id: options.id } },
                        Transaction: { create: { txHash: txHash } }
                    }
                },
                StatusHistory: {
                    connect: { id: purchase.CurrentStatus.id }
                }
            }
        })

        return { txHash }
    },
});