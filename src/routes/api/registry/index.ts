import { payAuthenticatedEndpointFactory } from '@/utils/endpoint-factory/pay-authenticated';
import { z } from 'zod';
import { $Enums } from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { BlockfrostProvider, MeshWallet, Transaction } from '@meshsdk/core';
import { decrypt } from '@/utils/encryption';
import { blake2b } from 'ethereum-cryptography/blake2b.js';
import { resolvePaymentKeyHash } from '@meshsdk/core-cst';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { getRegistryScriptFromNetworkHandlerV1 } from '@/utils/contractResolver';
import { metadataStringConvert } from '@/utils/metadata-string-convert';
import { DEFAULTS } from '@/utils/config';

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
    network: z.nativeEnum($Enums.Network).describe("The Cardano network used to register the agent on"),
    paymentContractAddress: z.string().max(250).optional().describe("The smart contract address of the payment contract to which the registration belongs"),
})

export const queryAgentSchemaOutput = z.object({
    assets: z.array(z.object({
        unit: z.string().max(250),
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
    handler: async ({ input }) => {
        const paymentContractAddress = input.paymentContractAddress ?? input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD
        const networkCheckSupported = await prisma.networkHandler.findUnique({ where: { network_paymentContractAddress: { network: input.network, paymentContractAddress: paymentContractAddress } }, include: { AdminWallets: true, SellingWallets: { include: { WalletSecret: true } } } })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        const blockfrost = new BlockFrostAPI({
            projectId: networkCheckSupported.rpcProviderApiKey,
        })
        const wallet = networkCheckSupported.SellingWallets.find(wallet => wallet.walletVkey == input.walletVKey)
        if (wallet == null) {
            throw createHttpError(404, "Wallet not found")
        }
        const { policyId, } = await getRegistryScriptFromNetworkHandlerV1(networkCheckSupported)

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
                    name: metadataStringConvert(parsedMetadata.data.name!)!,
                    description: metadataStringConvert(parsedMetadata.data.description),
                    api_url: metadataStringConvert(parsedMetadata.data.api_url)!,
                    example_output: metadataStringConvert(parsedMetadata.data.example_output),
                    capability: {
                        name: metadataStringConvert(parsedMetadata.data.capability.name)!,
                        version: metadataStringConvert(parsedMetadata.data.capability.version)!,
                    },
                    author: {
                        name: metadataStringConvert(parsedMetadata.data.author.name)!,
                        contact: metadataStringConvert(parsedMetadata.data.author.contact),
                        organization: metadataStringConvert(parsedMetadata.data.author.organization),
                    },
                    legal: parsedMetadata.data.legal ? {
                        privacy_policy: metadataStringConvert(parsedMetadata.data.legal.privacy_policy),
                        terms: metadataStringConvert(parsedMetadata.data.legal.terms),
                        other: metadataStringConvert(parsedMetadata.data.legal.other),
                    } : undefined,
                    tags: parsedMetadata.data.tags.map(tag => metadataStringConvert(tag)!),
                    pricing: parsedMetadata.data.pricing.map(price => ({
                        quantity: price.quantity,
                        unit: metadataStringConvert(price.unit)!,
                    })),
                    image: metadataStringConvert(parsedMetadata.data.image)!,
                    metadata_version: parsedMetadata.data.metadata_version,
                }
            })
        }))

        return { assets: detailedAssets }
    },
});



export const registerAgentSchemaInput = z.object({
    network: z.nativeEnum($Enums.Network).describe("The Cardano network used to register the agent on"),
    paymentContractAddress: z.string().max(250).optional().describe("The smart contract address of the payment contract to be registered for"),
    sellingWalletVkey: z.string().max(250).optional().describe("The payment key of a specific wallet used for the registration"),
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
    txHash: z.string(),
});

export const registerAgentPost = payAuthenticatedEndpointFactory.build({
    method: "post",
    input: registerAgentSchemaInput,
    output: registerAgentSchemaOutput,
    handler: async ({ input, logger }) => {
        logger.info("Registering Agent", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD
        const networkCheckSupported = await prisma.networkHandler.findUnique({
            where: {
                network_paymentContractAddress: {
                    network: input.network,
                    paymentContractAddress: paymentContractAddress
                }
            }, include: { AdminWallets: true, SellingWallets: { include: { WalletSecret: true } } }
        })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }

        if (networkCheckSupported.SellingWallets == null || networkCheckSupported.SellingWallets.length == 0) {
            throw createHttpError(404, "No Selling Wallets found")
        }

        const blockchainProvider = new BlockfrostProvider(
            networkCheckSupported.rpcProviderApiKey,
        )

        let sellingWallet = networkCheckSupported.SellingWallets.find(wallet => wallet.walletVkey == input.sellingWalletVkey)
        if (sellingWallet == null) {
            if (input.sellingWalletVkey != null) {
                throw createHttpError(404, "Selling Wallet not found")
            }
            const randomIndex = Math.floor(Math.random() * networkCheckSupported.SellingWallets.length)
            sellingWallet = networkCheckSupported.SellingWallets[randomIndex]
        }

        const wallet = new MeshWallet({
            networkId: 0,
            fetcher: blockchainProvider,
            submitter: blockchainProvider,
            key: {
                type: 'mnemonic',
                words: decrypt(sellingWallet.WalletSecret.secret!).split(" "),
            },
        });

        const address = (await wallet.getUnusedAddresses())[0];

        const { script, policyId, smartContractAddress } = await getRegistryScriptFromNetworkHandlerV1(networkCheckSupported)


        const utxos = await wallet.getUtxos();
        if (utxos.length === 0) {
            throw new Error('No UTXOs found for the wallet');
        }

        /*const filteredUtxos = utxos.findIndex((a) => getLovelace(a.output.amount) > 0 && a.output.amount.length == 1);
        if (filteredUtxos == -1) {
            const tx = new Transaction({ initiator: wallet }).setTxInputs(utxos);

            tx.isCollateralNeeded = false;

            tx.sendLovelace(address, "5000000")
            //sign the transaction with our address
            tx.setChangeAddress(address).setRequiredSigners([address]);
            //build the transaction
            const unsignedTx = await tx.build();
            const signedTx = await wallet.signTx(unsignedTx, true);
            try {
                const txHash = await wallet.submitTx(signedTx);
                throw createHttpError(429, "Defrag error, try again later. Defrag via : " + txHash);
            } catch (error: unknown) {
                logger.error("Defrag failed with error", error)
                throw createHttpError(429, "Defrag error, try again later. Defrag failed with error");
            }
        }*/
        const firstUtxo = utxos[0];
        //utxos = utxos.filter((_, index) => index !== filteredUtxos);

        const txId = firstUtxo.input.txHash;
        const txIndex = firstUtxo.input.outputIndex;
        const serializedOutput = txId + txIndex.toString(16).padStart(8, '0');

        const serializedOutputUint8Array = new Uint8Array(
            Buffer.from(serializedOutput.toString(), 'hex'),
        );
        // Hash the serialized output using blake2b_256
        const blake2b256 = blake2b(serializedOutputUint8Array, 32);
        const assetName = Buffer.from(blake2b256).toString('hex');

        const redeemer = {
            data: { alternative: 0, fields: [] },
            tag: 'MINT',
        };


        const tx = new Transaction({ initiator: wallet }).setMetadata(674, {
            msg: ["Masumi", "RegisterAgent"],
        }).setTxInputs([
            //ensure our first utxo hash (serializedOutput) is used as first input
            firstUtxo,
            ...utxos.slice(1),
        ]);

        tx.isCollateralNeeded = true;

        //setup minting data separately as the minting function does not work well with hex encoded strings without some magic
        tx.txBuilder
            .mintPlutusScript(script.version)
            .mint('1', policyId, assetName)
            .mintingScript(script.code)
            .mintRedeemerValue(redeemer.data, 'Mesh');



        //setup the metadata
        tx.setMetadata(721, {
            [policyId]: {
                [assetName]: {

                    name: stringToMetadata(input.name),
                    description: stringToMetadata(input.description),
                    api_url: stringToMetadata(input.api_url),
                    example_output: stringToMetadata(input.example_output),
                    capability: input.capability ? {
                        name: stringToMetadata(input.capability.name),
                        version: stringToMetadata(input.capability.version)
                    } : undefined,
                    requests_per_hour: stringToMetadata(input.requests_per_hour),
                    author: {
                        name: stringToMetadata(input.author.name),
                        contact: input.author.contact ? stringToMetadata(input.author.contact) : undefined,
                        organization: input.author.organization ? stringToMetadata(input.author.organization) : undefined
                    },
                    legal: input.legal ? {
                        privacy_policy: input.legal?.privacy_policy ? stringToMetadata(input.legal.privacy_policy) : undefined,
                        terms: input.legal?.terms ? stringToMetadata(input.legal.terms) : undefined,
                        other: input.legal?.other ? stringToMetadata(input.legal.other) : undefined
                    } : undefined,
                    tags: input.tags,
                    pricing: input.pricing.map(pricing => ({
                        unit: stringToMetadata(pricing.unit),
                        quantity: pricing.quantity,
                    })),
                    image: "ipfs://QmXXW7tmBgpQpXoJMAMEXXFe9dyQcrLFKGuzxnHDnbKC7f",
                    metadata_version: "1"

                },
            },
        });
        //send the minted asset to the address where we want to receive payments
        tx.sendAssets(address, [{ unit: policyId + assetName, quantity: '1' }])
        tx.sendLovelace(address, "5000000")
        //sign the transaction with our address
        tx.setChangeAddress(address).setRequiredSigners([address]);
        //build the transaction
        const unsignedTx = await tx.build();
        const signedTx = await wallet.signTx(unsignedTx, true);
        try {

            //submit the transaction to the blockchain, it can take a bit until the transaction is confirmed and found on the explorer
            const txHash = await wallet.submitTx(signedTx);
            logger.info(`Minted 1 asset with the contract at:
            Tx ID: ${txHash}
            AssetName: ${assetName}
            PolicyId: ${policyId}
            AssetId: ${policyId + assetName}
            Smart Contract Address: ${smartContractAddress}
        `);
            return { txHash }
        } catch (error: unknown) {
            if (extractErrorMessage(error).includes("ValueNotConservedUTxO")) {
                // too many requests
                throw createHttpError(429, "Too many requests");
            }

            throw createHttpError(500, "Failed to register agent");
        }

    },
});
export function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function stringToMetadata(s: string | undefined) {
    if (s == undefined) {
        return undefined
    }
    //split every 50 characters
    const arr = []
    for (let i = 0; i < s.length; i += 50) {
        arr.push(s.slice(i, i + 50))
    }
    return arr
}


export const unregisterAgentSchemaInput = z.object({
    assetName: z.string().max(250).describe("The identifier of the registration (asset) to be deregistered"),
    network: z.nativeEnum($Enums.Network).describe("The network the registration was made on"),
    paymentContractAddress: z.string().max(250).optional().describe("The smart contract address of the payment contract to which the registration belongs"),
})

export const unregisterAgentSchemaOutput = z.object({
    txHash: z.string(),
});

export const unregisterAgentDelete = payAuthenticatedEndpointFactory.build({
    method: "delete",
    input: unregisterAgentSchemaInput,
    output: unregisterAgentSchemaOutput,
    handler: async ({ input, logger }) => {
        logger.info("Deregister Agent", input.paymentTypes);
        const paymentContractAddress = input.paymentContractAddress ?? input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD
        const networkCheckSupported = await prisma.networkHandler.findUnique({ where: { network_paymentContractAddress: { network: input.network, paymentContractAddress: paymentContractAddress } }, include: { AdminWallets: true, SellingWallets: { include: { WalletSecret: true } } } })
        if (networkCheckSupported == null) {
            throw createHttpError(404, "Network and Address combination not supported")
        }
        if (networkCheckSupported.SellingWallets == null || networkCheckSupported.SellingWallets.length == 0) {
            throw createHttpError(404, "Selling Wallet not found")
        }
        const blockchainProvider = new BlockfrostProvider(
            networkCheckSupported.rpcProviderApiKey,
        )
        const blockfrost = new BlockFrostAPI({
            projectId: networkCheckSupported.rpcProviderApiKey,
        })
        const { policyId, script, smartContractAddress } = await getRegistryScriptFromNetworkHandlerV1(networkCheckSupported)

        let assetName = input.assetName
        if (assetName.startsWith(policyId)) {
            assetName = assetName.slice(policyId.length)
        }
        const holderWallet = await blockfrost.assetsAddresses(policyId + assetName, { order: "desc", count: 1 })
        if (holderWallet.length == 0) {
            throw createHttpError(404, "Asset not found")
        }
        const vkey = resolvePaymentKeyHash(holderWallet[0].address)

        const sellingWallet = networkCheckSupported.SellingWallets.find(wallet => wallet.walletVkey == vkey)
        if (sellingWallet == null) {
            throw createHttpError(404, "Registered Wallet not found")
        }
        const wallet = new MeshWallet({
            networkId: 0,
            fetcher: blockchainProvider,
            submitter: blockchainProvider,
            key: {
                type: 'mnemonic',
                words: decrypt(sellingWallet.WalletSecret.secret!).split(" "),
            },
        });

        const address = (await wallet.getUnusedAddresses())[0];


        const utxos = await wallet.getUtxos();
        if (utxos.length === 0) {
            throw new Error('No UTXOs found for the wallet');
        }


        const redeemer = {
            data: { alternative: 1, fields: [] },
        };

        const tx = new Transaction({ initiator: wallet }).setMetadata(674, {
            msg: ["Masumi", "DeregisterAgent"],
        }).setTxInputs(utxos);

        tx.isCollateralNeeded = true;

        //setup minting data separately as the minting function does not work well with hex encoded strings without some magic
        tx.txBuilder
            .mintPlutusScript(script.version)
            .mint('-1', policyId, assetName)
            .mintingScript(script.code)
            .mintRedeemerValue(redeemer.data, 'Mesh');
        tx.sendLovelace(address, "5000000")
        //send the minted asset to the address where we want to receive payments
        //used to defrag for further transactions
        //sign the transaction with our address
        tx.setChangeAddress(address).setRequiredSigners([address]);
        //build the transaction
        const unsignedTx = await tx.build();
        const signedTx = await wallet.signTx(unsignedTx, true);
        //submit the transaction to the blockchain, it can take a bit until the transaction is confirmed and found on the explorer
        const txHash = await wallet.submitTx(signedTx);

        console.log(`Burned 1 asset with the contract at:
    Tx ID: ${txHash}
    AssetName: ${assetName}
    PolicyId: ${policyId}
    Smart Contract Address: ${smartContractAddress}
`);
        return { txHash }
    },
});