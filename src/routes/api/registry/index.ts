import { payAuthenticatedEndpointFactory } from '@/utils/security/auth/pay-authenticated';
import { z } from 'zod';
import { HotWalletType, Network, RegistrationState } from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { resolvePaymentKeyHash } from '@meshsdk/core-cst';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { getRegistryScriptFromNetworkHandlerV1 } from '@/utils/generator/contract-generator';
import { metadataToString } from '@/utils/converter/metadata-string-convert';
import { DEFAULTS } from '@/utils/config';
import { checkIsAllowedNetworkOrThrowUnauthorized } from '@/utils/middleware/auth-middleware';

const metadataSchema = z.object({
    name: z.string().min(1).or(z.array(z.string().min(1))),
    description: z.string().or(z.array(z.string())).optional(),
    api_url: z.string().min(1).url().or(z.array(z.string().min(1))),
    example_output: z.string().or(z.array(z.string())).optional(),
    capability: z.object({
        name: z.string().or(z.array(z.string())),
        version: z.string().or(z.array(z.string())),
    }),
    requests_per_hour: z.string().or(z.array(z.string())).optional(),
    author: z.object({
        name: z.string().min(1).or(z.array(z.string().min(1))),
        contact: z.string().or(z.array(z.string())).optional(),
        organization: z.string().or(z.array(z.string())).optional()
    }),
    legal: z.object({
        privacy_policy: z.string().or(z.array(z.string())).optional(),
        terms: z.string().or(z.array(z.string())).optional(),
        other: z.string().or(z.array(z.string())).optional()
    }).optional(),
    tags: z.array(z.string().min(1)).min(1),
    pricing: z.array(z.object({
        quantity: z.number({ coerce: true }).int().min(1),
        unit: z.string().min(1).or(z.array(z.string().min(1)))
    })).min(1),
    image: z.string().or(z.array(z.string())),
    metadata_version: z.number({ coerce: true }).int().min(1).max(1)
})

export const queryAgentSchemaInput = z.object({
    walletVKey: z.string().max(250).describe("The payment key of the wallet to be queried"),
    network: z.nativeEnum(Network).describe("The Cardano network used to register the agent on"),
    smartContractAddress: z.string().max(250).optional().describe("The smart contract address of the payment source to which the registration belongs"),
})

export const queryAgentSchemaOutput = z.object({
    assets: z.array(z.object({
        policyId: z.string(),
        assetName: z.string(),
        agentIdentifier: z.string(),
        metadata: z.object({
            name: z.string().max(250),
            description: z.string().max(250).nullable().optional(),
            api_url: z.string().max(250),
            example_output: z.string().max(250).nullable().optional(),
            tags: z.array(z.string().max(250)),
            requests_per_hour: z.string().max(250).nullable().optional(),
            capability: z.object({
                name: z.string().max(250),
                version: z.string().max(250),
            }),
            author: z.object({
                name: z.string().max(250),
                contact: z.string().max(250).nullable().optional(),
                organization: z.string().max(250).nullable().optional(),
            }),
            legal: z.object({
                privacy_policy: z.string().max(250).nullable().optional(),
                terms: z.string().max(250).nullable().optional(),
                other: z.string().max(250).nullable().optional(),
            }).nullable().optional(),
            pricing: z.array(z.object({
                quantity: z.number({ coerce: true }).int().min(1),
                unit: z.string().max(250),
            })).min(1),
            image: z.string().max(250),
            metadata_version: z.number({ coerce: true }).int().min(1).max(1)
        }),
    })),
})
export const queryAgentGet = payAuthenticatedEndpointFactory.build({
    method: "get",
    input: queryAgentSchemaInput,
    output: queryAgentSchemaOutput,
    handler: async ({ input, options }) => {
        const smartContractAddress = input.smartContractAddress ?? (input.network == Network.Mainnet ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const paymentSource = await prisma.paymentSource.findUnique({ where: { network_smartContractAddress: { network: input.network, smartContractAddress: smartContractAddress } }, include: { PaymentSourceConfig: true, HotWallets: true } })
        if (paymentSource == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        await checkIsAllowedNetworkOrThrowUnauthorized(options.networkLimit, input.network, options.permission)
        const blockfrost = new BlockFrostAPI({
            projectId: paymentSource.PaymentSourceConfig.rpcProviderApiKey,
        })
        const wallet = paymentSource.HotWallets.find(wallet => wallet.walletVkey == input.walletVKey && wallet.type == HotWalletType.Selling)
        if (wallet == null) {
            throw createHttpError(404, "Wallet not found")
        }
        const { policyId, } = await getRegistryScriptFromNetworkHandlerV1(paymentSource)

        const addressInfo = await blockfrost.addresses(wallet.walletAddress)
        if (addressInfo.stake_address == null) {
            throw createHttpError(404, "Stake address not found")
        }
        const stakeAddress = addressInfo.stake_address

        const holderWallet = await blockfrost.accountsAddressesAssetsAll(stakeAddress)
        if (!holderWallet || holderWallet.length == 0) {
            throw createHttpError(404, "Asset not found")
        }
        const assets = holderWallet.filter(asset => asset.unit.startsWith(policyId))
        const detailedAssets: { unit: string, metadata: z.infer<typeof queryAgentSchemaOutput>["assets"][0]["metadata"] }[] = []

        await Promise.all(assets.map(async (asset) => {
            const assetInfo = await blockfrost.assetsById(asset.unit)
            const parsedMetadata = metadataSchema.safeParse(assetInfo.onchain_metadata)
            if (!parsedMetadata.success) {
                return
            }
            detailedAssets.push({
                unit: asset.unit,
                metadata:
                {
                    name: metadataToString(parsedMetadata.data.name!)!,
                    description: metadataToString(parsedMetadata.data.description),
                    api_url: metadataToString(parsedMetadata.data.api_url)!,
                    example_output: metadataToString(parsedMetadata.data.example_output),
                    capability: {
                        name: metadataToString(parsedMetadata.data.capability.name)!,
                        version: metadataToString(parsedMetadata.data.capability.version)!,
                    },
                    author: {
                        name: metadataToString(parsedMetadata.data.author.name)!,
                        contact: metadataToString(parsedMetadata.data.author.contact),
                        organization: metadataToString(parsedMetadata.data.author.organization),
                    },
                    legal: parsedMetadata.data.legal ? {
                        privacy_policy: metadataToString(parsedMetadata.data.legal.privacy_policy),
                        terms: metadataToString(parsedMetadata.data.legal.terms),
                        other: metadataToString(parsedMetadata.data.legal.other),
                    } : undefined,
                    tags: parsedMetadata.data.tags.map(tag => metadataToString(tag)!),
                    pricing: parsedMetadata.data.pricing.map(price => ({
                        quantity: price.quantity,
                        unit: metadataToString(price.unit)!,
                    })),
                    image: metadataToString(parsedMetadata.data.image)!,
                    metadata_version: parsedMetadata.data.metadata_version,
                }
            })
        }))

        return {
            assets: detailedAssets.map(asset => ({
                policyId: policyId,
                assetName: asset.unit.slice(policyId.length),
                agentIdentifier: asset.unit,
                metadata: asset.metadata,
            })),
        }
    },
});



export const registerAgentSchemaInput = z.object({
    network: z.nativeEnum(Network).describe("The Cardano network used to register the agent on"),
    smartContractAddress: z.string().max(250).optional().describe("The smart contract address of the payment contract to be registered for"),
    sellingWalletVkey: z.string().max(250).optional().describe("The payment key of a specific wallet used for the registration"),
    example_output: z.string().max(250).optional().describe("Link to a example output of the agent"),
    tags: z.array(z.string().max(63)).min(1).max(15).describe("Tags used in the registry metadata"),
    name: z.string().max(250).describe("Name of the agent"),
    api_url: z.string().max(250).describe("Base URL of the agent, to request interactions"),
    description: z.string().max(250).describe("Description of the agent"),
    capability: z.object({ name: z.string().max(250), version: z.string().max(250) }).describe("Provide information about the used AI model and version"),
    requests_per_hour: z.string().max(250).describe("The request the agent can handle per hour"),
    pricing: z.array(z.object({
        unit: z.string().max(250),
        quantity: z.string().max(55),
    })).max(5).describe("Price for a default interaction"),
    legal: z.object({
        privacy_policy: z.string().max(250).optional(),
        terms: z.string().max(250).optional(),
        other: z.string().max(250).optional(),
    }).optional().describe("Legal information about the agent"),
    author: z.object({
        name: z.string().max(250),
        contact: z.string().max(250).optional(),
        organization: z.string().max(250).optional(),
    }).describe("Author information about the agent"),
})

export const registerAgentSchemaOutput = z.object({
    name: z.string(),
    api_url: z.string(),
    capability_name: z.string(),
    capability_version: z.string(),
    description: z.string().nullable(),
    requests_per_hour: z.string().nullable(),
    privacy_policy: z.string().nullable(),
    terms: z.string().nullable(),
    other: z.string().nullable(),
    tags: z.array(z.string()),
    state: z.nativeEnum(RegistrationState),
    SmartContractWallet: z.object({
        walletVkey: z.string(),
        walletAddress: z.string(),
    }).nullable(),
    Pricing: z.array(z.object({
        unit: z.string(),
        quantity: z.string(),
    })),
});

export const registerAgentPost = payAuthenticatedEndpointFactory.build({
    method: "post",
    input: registerAgentSchemaInput,
    output: registerAgentSchemaOutput,
    handler: async ({ input, options }) => {
        const smartContractAddress = input.smartContractAddress ?? (input.network == Network.Mainnet ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const paymentSource = await prisma.paymentSource.findUnique({
            where: {
                network_smartContractAddress: {
                    network: input.network,
                    smartContractAddress: smartContractAddress
                }
            }, include: { AdminWallets: true, HotWallets: { include: { Secret: true } }, PaymentSourceConfig: true }
        })
        if (paymentSource == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        await checkIsAllowedNetworkOrThrowUnauthorized(options.networkLimit, input.network, options.permission)

        const sellingWallet = paymentSource.HotWallets.find(wallet => wallet.walletVkey == input.sellingWalletVkey && wallet.type == HotWalletType.Selling)
        const result = await prisma.registryRequest.create({
            data: {
                name: input.name,
                description: input.description,
                api_url: input.api_url,
                capability_name: input.capability.name,
                capability_version: input.capability.version,
                requests_per_hour: input.requests_per_hour,
                author_name: input.author.name,
                author_contact: input.author.contact,
                author_organization: input.author.organization,
                state: RegistrationState.RegistrationRequested,
                SmartContractWallet: sellingWallet ? {
                    connect: {
                        id: sellingWallet.id
                    }
                } : undefined,
                PaymentSource: {
                    connect: {
                        id: paymentSource.id
                    }
                },
                tags: input.tags,
                Pricing: {
                    createMany: {
                        data: input.pricing.map(price => ({
                            unit: price.unit,
                            quantity: parseInt(price.quantity),
                        }))
                    }
                }
            },
            include: {
                Pricing: true,
                SmartContractWallet: true,
            }
        })

        return {
            ...result,
            Pricing: result.Pricing.map(pricing => ({
                unit: pricing.unit,
                quantity: pricing.quantity.toString(),
            }))
        }
    },
});





export const unregisterAgentSchemaInput = z.object({
    assetName: z.string().max(250).describe("The identifier of the registration (asset) to be deregistered"),
    network: z.nativeEnum(Network).describe("The network the registration was made on"),
    smartContractAddress: z.string().max(250).optional().describe("The smart contract address of the payment contract to which the registration belongs"),
})

export const unregisterAgentSchemaOutput = z.object({
    name: z.string(),
    api_url: z.string(),
    capability_name: z.string(),
    capability_version: z.string(),
    description: z.string().nullable(),
    requests_per_hour: z.string().nullable(),
    privacy_policy: z.string().nullable(),
    terms: z.string().nullable(),
    other: z.string().nullable(),
    tags: z.array(z.string()),
    SmartContractWallet: z.object({
        walletVkey: z.string(),
        walletAddress: z.string(),
    }).nullable(),
    state: z.nativeEnum(RegistrationState),
    Pricing: z.array(z.object({
        unit: z.string(),
        quantity: z.string(),
    })),
});

export const unregisterAgentDelete = payAuthenticatedEndpointFactory.build({
    method: "delete",
    input: unregisterAgentSchemaInput,
    output: unregisterAgentSchemaOutput,
    handler: async ({ input, options }) => {
        const smartContractAddress = input.smartContractAddress ?? (input.network == Network.Mainnet ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD)
        const paymentSource = await prisma.paymentSource.findUnique({
            where: {
                network_smartContractAddress: { network: input.network, smartContractAddress: smartContractAddress }
            }, include: {
                PaymentSourceConfig: true,
                HotWallets: { include: { Secret: true } }
            }
        })
        if (paymentSource == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }

        await checkIsAllowedNetworkOrThrowUnauthorized(options.networkLimit, input.network, options.permission)

        const blockfrost = new BlockFrostAPI({
            projectId: paymentSource.PaymentSourceConfig.rpcProviderApiKey,
        })

        const { policyId } = await getRegistryScriptFromNetworkHandlerV1(paymentSource)

        let assetName = input.assetName
        if (assetName.startsWith(policyId)) {
            assetName = assetName.slice(policyId.length)
        }
        const holderWallet = await blockfrost.assetsAddresses(policyId + assetName, { order: "desc", count: 1 })
        if (holderWallet.length == 0) {
            throw createHttpError(404, "Asset not found")
        }
        const vkey = resolvePaymentKeyHash(holderWallet[0].address)

        const sellingWallet = paymentSource.HotWallets.find(wallet => wallet.walletVkey == vkey && wallet.type == HotWalletType.Selling)
        if (sellingWallet == null) {
            throw createHttpError(404, "Registered Wallet not found")
        }
        const registryRequest = await prisma.registryRequest.findUnique({
            where: {
                agentIdentifier: policyId + assetName
            },
        })
        if (registryRequest == null) {
            throw createHttpError(404, "Registration not found")
        }
        const result = await prisma.registryRequest.update({
            where: { id: registryRequest.id },
            data: {
                state: RegistrationState.DeregistrationRequested
            },
            include: {
                Pricing: true,
                SmartContractWallet: true,
            }
        })

        return {
            ...result,
            Pricing: result.Pricing.map(pricing => ({
                unit: pricing.unit,
                quantity: pricing.quantity.toString(),
            }))
        }
    },
});