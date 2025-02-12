import { readAuthenticatedEndpointFactory } from '@/utils/security/auth/read-authenticated';
import { z } from 'zod';
import { $Enums, HotWalletType, } from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { ez } from 'express-zod-api';
import cuid2 from '@paralleldrive/cuid2';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { BlockfrostProvider, mBool, resolvePaymentKeyHash, SLOT_CONFIG_NETWORK, Transaction, unixTimeToEnclosingSlot } from '@meshsdk/core';
import { getPaymentScriptFromNetworkHandlerV1, getRegistryScriptV1, getSmartContractStateDatum, SmartContractState } from '@/utils/generator/contract-generator';
import { DEFAULTS } from '@/utils/config';
import { generateWalletExtended } from '@/utils/generator/wallet-generator';
import { decodeV1ContractDatum } from '@/utils/converter/string-datum-convert';
import * as cbor from "cbor"
import { convertNetwork } from '@/utils/converter/network-convert';

export const queryPaymentsSchemaInput = z.object({
    limit: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of payments to return"),
    cursorId: z.string().optional().describe("Used to paginate through the payments. If this is provided, cursorId is required"),
    network: z.nativeEnum($Enums.Network).describe("The network the payments were made on"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the payments were made to"),
    includeHistory: z.boolean().optional().default(false).describe("Whether to include the full transaction and status history of the payments")
})

export const queryPaymentsSchemaOutput = z.object({
    payments: z.array(z.object({
        id: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        blockchainIdentifier: z.string(),
        lastCheckedAt: z.date().nullable(),
        networkHandlerId: z.string(),
        smartContractWalletId: z.string().nullable(),
        buyerWalletId: z.string().nullable(),
        submitResultTime: z.string(),
        unlockTime: z.string(),
        refundTime: z.string(),
        requestedById: z.string(),
        CurrentStatus: z.object({
            status: z.nativeEnum($Enums.PaymentRequestStatus),
            Transaction: z.object({
                txHash: z.string().nullable(),
            }).nullable(),
            errorType: z.nativeEnum($Enums.PaymentRequestErrorType).nullable(),
            errorNote: z.string().nullable(),
            errorRequiresManualReview: z.boolean().nullable(),
        }),
        StatusHistory: z.array(z.object({
            status: z.nativeEnum($Enums.PaymentRequestStatus),
            Transaction: z.object({
                txHash: z.string().nullable(),
            }).nullable(),
            errorType: z.nativeEnum($Enums.PaymentRequestErrorType).nullable(),
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
        BuyerWallet: z.object({
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
                    network: input.network,
                    paymentContractAddress: paymentContractAddress
                }
            },
            include: {
                HotWallets: true,
                NetworkHandlerConfig: true
            }
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
                Amounts: true,
                CurrentStatus: {
                    include: {
                        Transaction: true
                    }
                },
                StatusHistory: {
                    orderBy: { timestamp: 'desc' },
                    include: { Transaction: true },
                    take: input.includeHistory ? undefined : 0
                }
            }
        })
        if (result == null) {
            throw createHttpError(404, "Payment not found")
        }

        return {
            payments: result.map(payment => ({
                ...payment,
                submitResultTime: payment.submitResultTime.toString(),
                unlockTime: payment.unlockTime.toString(),
                refundTime: payment.refundTime.toString(),
                Amounts: payment.Amounts.map(amount => ({
                    ...amount,
                    amount: amount.amount.toString()
                }))
            }))
        }
    },
});


export const createPaymentsSchemaInput = z.object({
    network: z.nativeEnum($Enums.Network).describe("The network the payment will be received on"),
    agentIdentifier: z.string().min(15).max(250).describe("The identifier of the agent that will be paid"),
    amounts: z.array(z.object({ amount: z.string(), unit: z.string() })).max(7).describe("The amounts of the payment"),
    paymentType: z.nativeEnum($Enums.PaymentType).describe("The type of payment contract used"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the payment will be made to"),
    submitResultTime: ez.dateIn().default(new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString()).describe("The time after which the payment has to be submitted to the smart contract"),
    unlockTime: ez.dateIn().optional().describe("The time after which the payment will be unlocked"),
    refundTime: ez.dateIn().optional().describe("The time after which a refund will be approved"),
    metadata: z.string().optional().describe("Metadata to be stored with the payment request"),
})

export const createPaymentSchemaOutput = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    blockchainIdentifier: z.string(),
    lastCheckedAt: z.date().nullable(),
    networkHandlerId: z.string(),
    smartContractWalletId: z.string().nullable(),
    buyerWalletId: z.string().nullable(),
    submitResultTime: z.string(),
    unlockTime: z.string(),
    refundTime: z.string(),
    requestedById: z.string(),
    CurrentStatus: z.object({
        status: z.nativeEnum($Enums.PaymentRequestStatus),
        Transaction: z.object({
            txHash: z.string().nullable(),
        }).nullable(),
        errorType: z.nativeEnum($Enums.PaymentRequestErrorType).nullable(),
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
    BuyerWallet: z.object({
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

export const paymentInitPost = readAuthenticatedEndpointFactory.build({
    method: "post",
    input: createPaymentsSchemaInput,
    output: createPaymentSchemaOutput,
    handler: async ({ input, options, logger }) => {
        logger.info("Creating purchase", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkCheckSupported = await prisma.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: {
                    network: input.network,
                    paymentContractAddress: paymentContractAddress
                }
            }, include: { HotWallets: true, NetworkHandlerConfig: true }
        })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }


        const unlockTime = input.unlockTime != undefined ? input.unlockTime.getTime() : new Date(input.submitResultTime.getTime() + 1000 * 60 * 60 * 6).getTime() // 6h
        const refundTime = input.refundTime != undefined ? input.refundTime.getTime() : new Date(input.submitResultTime.getTime() + 1000 * 60 * 60 * 12).getTime() // 12h

        const provider = new BlockFrostAPI({
            projectId: networkCheckSupported.NetworkHandlerConfig.rpcProviderApiKey
        })
        const { policyId } = await getRegistryScriptV1(paymentContractAddress, input.network)
        const assetId = input.agentIdentifier;
        const policyAsset = assetId.startsWith(policyId) ? assetId : policyId + assetId;
        const assetInWallet = await provider.assetsAddresses(policyAsset, { order: "desc", count: 1 })
        if (assetInWallet.length == 0) {
            throw createHttpError(404, "Agent identifier not found")
        }

        const vKey = resolvePaymentKeyHash(assetInWallet[0].address)

        const sellingWallet = networkCheckSupported.HotWallets.find(wallet => wallet.walletVkey == vKey && wallet.type == HotWalletType.SELLING)
        if (sellingWallet == null) {
            throw createHttpError(404, "Agent identifier not found in selling wallets")
        }

        const payment = await prisma.paymentRequest.create({
            data: {
                blockchainIdentifier: input.agentIdentifier + "_" + cuid2.createId(),
                NetworkHandler: { connect: { id: networkCheckSupported.id } },
                Amounts: {
                    createMany: {
                        data: input.amounts.map(amount => {
                            if (amount.unit == "") {
                                return { amount: BigInt(amount.amount), unit: "lovelace" }
                            } else {
                                return { amount: BigInt(amount.amount), unit: amount.unit }
                            }
                        })
                    }
                },
                CurrentStatus: {
                    create: {
                        status: $Enums.PaymentRequestStatus.PaymentRequested,
                        timestamp: new Date()
                    }
                },
                SmartContractWallet: { connect: { id: sellingWallet.id } },
                submitResultTime: input.submitResultTime.getTime(),
                unlockTime: unlockTime,
                refundTime: refundTime,

                requestedBy: { connect: { id: options.id } },
                metadata: input.metadata
            },
            include: {
                Amounts: true,
                BuyerWallet: true,
                SmartContractWallet: true,
                NetworkHandler: true,
                CurrentStatus: {
                    include: {
                        Transaction: true
                    }
                }
            }
        })
        if (payment.SmartContractWallet == null) {
            throw createHttpError(500, "Smart contract wallet not connected")
        }
        return {
            ...payment,
            submitResultTime: payment.submitResultTime.toString(),
            unlockTime: payment.unlockTime.toString(),
            refundTime: payment.refundTime.toString(),
            Amounts: payment.Amounts.map(amount => ({
                ...amount,
                amount: amount.amount.toString()
            }))
        }
    },
});

export const updatePaymentsSchemaInput = z.object({
    network: z.nativeEnum($Enums.Network).describe("The network the payment was received on"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the payment was made to"),
    submitResultHash: z.string().max(250).describe("The hash of the AI agent result to be submitted"),
    blockchainIdentifier: z.string().max(250).describe("The identifier of the payment"),
    sellerVkey: z.string().max(250).describe("The vkey of the seller"),
})

export const updatePaymentSchemaOutput = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    blockchainIdentifier: z.string(),
    lastCheckedAt: z.date().nullable(),
    networkHandlerId: z.string(),
    smartContractWalletId: z.string().nullable(),
    buyerWalletId: z.string().nullable(),
    submitResultTime: z.string(),
    unlockTime: z.string(),
    refundTime: z.string(),
    requestedById: z.string(),
    metadata: z.string().nullable(),
    CurrentStatus: z.object({
        status: z.nativeEnum($Enums.PaymentRequestStatus),
        Transaction: z.object({
            txHash: z.string().nullable(),
        }).nullable(),
        errorType: z.nativeEnum($Enums.PaymentRequestErrorType).nullable(),
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
    BuyerWallet: z.object({
        id: z.string(),
        walletVkey: z.string(),
    }).nullable(),
    SmartContractWallet: z.object({
        id: z.string(),
        walletVkey: z.string(),
        walletAddress: z.string(),
    }).nullable(),
});

export const paymentUpdatePatch = readAuthenticatedEndpointFactory.build({
    method: "patch",
    input: updatePaymentsSchemaInput,
    output: updatePaymentSchemaOutput,
    handler: async ({ input, options, logger }) => {
        logger.info("Creating purchase", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkCheckSupported = await prisma.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: {
                    network: input.network, paymentContractAddress: paymentContractAddress
                }
            }, include: { HotWallets: true, NetworkHandlerConfig: true, PaymentRequests: { where: { blockchainIdentifier: input.blockchainIdentifier, CurrentStatus: { status: $Enums.PaymentRequestStatus.PaymentRequested } }, include: { CurrentStatus: true, SmartContractWallet: true } } }
        })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        if (networkCheckSupported.PaymentRequests.length == 0) {
            throw createHttpError(404, "Payment not found")
        }
        const payment = networkCheckSupported.PaymentRequests[0];
        if (payment.SmartContractWallet == null) {
            throw createHttpError(404, "Smart contract wallet not found")
        }
        if (payment.SmartContractWallet.walletVkey != input.sellerVkey) {
            throw createHttpError(400, "Seller vkey does not match")
        }

        const result = await prisma.paymentRequest.update({
            where: { id: networkCheckSupported.PaymentRequests[0].id },
            data: {
                CurrentStatus: {
                    create: {
                        status: $Enums.PaymentRequestStatus.ResultGenerated,
                        timestamp: new Date(),
                        requestedBy: { connect: { id: options.id } },
                        resultHash: input.submitResultHash
                    }
                },
                StatusHistory: { connect: { id: networkCheckSupported.PaymentRequests[0].CurrentStatus.id } },
            },
            include: {
                CurrentStatus: {
                    include: {
                        Transaction: true
                    }
                },
                BuyerWallet: true,
                SmartContractWallet: true,
                NetworkHandler: true,
                Amounts: true
            }
        })

        return {
            ...result,
            submitResultTime: result.submitResultTime.toString(),
            unlockTime: result.unlockTime.toString(),
            refundTime: result.refundTime.toString(),
            Amounts: result.Amounts.map(amount => ({
                ...amount,
                amount: amount.amount.toString()
            }))
        }
    },
});


export const refundPaymentSchemaInput = z.object({
    blockchainIdentifier: z.string().max(250).describe("The identifier of the purchase to be refunded"),
    sellerVkey: z.string().max(250).describe("The vkey of the seller"),
    network: z.nativeEnum($Enums.Network).describe("The network the Cardano wallet will be used on"),
    paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract holding the purchase"),
})

export const refundPaymentSchemaOutput = z.object({
    txHash: z.string(),
});

export const refundPaymentDelete = readAuthenticatedEndpointFactory.build({
    method: "delete",
    input: refundPaymentSchemaInput,
    output: refundPaymentSchemaOutput,
    handler: async ({ input, options, logger }) => {
        logger.info("Refunding payment", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const networkCheckSupported = await prisma.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: { network: input.network, paymentContractAddress: paymentContractAddress }
            }, include: {
                FeeReceiverNetworkWallet: true,
                AdminWallets: true,
                NetworkHandlerConfig: true,
                PaymentRequests: {
                    where: {
                        blockchainIdentifier: input.blockchainIdentifier
                    }, include: {
                        BuyerWallet: true,
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
        if (networkCheckSupported.PaymentRequests.length == 0) {
            throw createHttpError(404, "Purchase not found")
        }
        const purchase = networkCheckSupported.PaymentRequests[0];
        if (purchase.SmartContractWallet == null) {
            throw createHttpError(404, "Smart contract wallet not found")
        }
        if (purchase.SmartContractWallet.walletVkey != input.sellerVkey) {
            throw createHttpError(400, "Seller vkey does not match")
        }
        if (purchase.CurrentStatus.status != $Enums.PaymentRequestStatus.RefundRequested) {
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


        const sellerVerificationKeyHash = purchase.SmartContractWallet?.walletVkey;
        const buyerVerificationKeyHash = purchase.BuyerWallet?.walletVkey;
        if (!sellerVerificationKeyHash)
            throw createHttpError(404, "seller wallet not found")
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
                    0,
                    decodedContract.newCooldownTime,
                    getSmartContractStateDatum(SmartContractState.RefundRequested),
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