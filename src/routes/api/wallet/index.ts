import { adminAuthenticatedEndpointFactory } from '@/utils/endpoint-factory/admin-authenticated';
import { z } from 'zod';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { decrypt } from '@/utils/encryption';
import { Network } from '@prisma/client';
import { MeshWallet } from '@meshsdk/core';
import { resolvePaymentKeyHash } from '@meshsdk/core-cst';
import { convertNetworkToId } from '@/utils/networkConverter';



export const getWalletSchemaInput = z.object({
    walletType: z.enum(["Selling", "Purchasing"]).describe("The type of wallet to query"),
    id: z.string().min(1).max(250).describe("The id of the wallet to query"),
    includeSecret: z.string().transform((s) => s.toLowerCase() == "true" ? true : false).default("false").describe("Whether to include the decrypted secret in the response")
})


export const getWalletSchemaOutput = z.object({
    WalletSecret: z.object({
        createdAt: z.date(),
        updatedAt: z.date(),
        secret: z.string(),
    }).optional(),
    PendingTransaction: z.object({
        createdAt: z.date(),
        updatedAt: z.date(),
        hash: z.string().nullable(),
        lastCheckedAt: z.date().nullable(),
    }).nullable(),
    note: z.string().nullable(),
    walletVkey: z.string(),
    walletAddress: z.string()
});

export const queryWalletEndpointGet = adminAuthenticatedEndpointFactory.build({
    method: "get",
    input: getWalletSchemaInput,
    output: getWalletSchemaOutput,
    handler: async ({ input }) => {
        if (input.walletType == "Selling") {
            const result = await prisma.sellingWallet.findFirst({ where: { id: input.id }, include: { WalletSecret: true, PendingTransaction: true, NetworkHandler: true } })
            if (result == null) {
                throw createHttpError(404, "Selling wallet not found")
            }

            if (input.includeSecret == true) {
                const decodedSecret = decrypt(result.WalletSecret.secret)
                return {
                    ...result,
                    walletSecret: {
                        ...result.WalletSecret,
                        secret: decodedSecret
                    },
                }
            }
            return { ...result, WalletSecret: undefined }
        } else if (input.walletType == "Purchasing") {
            const result = await prisma.purchasingWallet.findFirst({ where: { id: input.id }, include: { WalletSecret: true, PendingTransaction: true, NetworkHandler: true } })
            if (result == null) {
                throw createHttpError(404, "Purchasing wallet not found")
            }

            if (input.includeSecret == true) {
                const decodedSecret = decrypt(result.WalletSecret.secret)
                return {
                    ...result,
                    WalletSecret: {
                        ...result.WalletSecret,
                        secret: decodedSecret
                    },
                }
            }
            return { ...result, walletSecret: undefined }

        }
        throw createHttpError(400, "Invalid wallet type")
    },
});


export const postWalletSchemaInput = z.object({
    network: z.nativeEnum(Network).describe("The network the Cardano wallet will be used on"),
})


export const postWalletSchemaOutput = z.object({
    walletMnemonic: z.string(),
    walletAddress: z.string(),
    walletVkey: z.string(),
});

export const postWalletEndpointPost = adminAuthenticatedEndpointFactory.build({
    method: "post",
    input: postWalletSchemaInput,
    output: postWalletSchemaOutput,
    handler: async ({ input }) => {
        const secretKey = MeshWallet.brew(false);
        const secretWords = typeof secretKey == "string" ? secretKey.split(" ") : secretKey

        const networkId = convertNetworkToId(input.network)

        const wallet = new MeshWallet({
            networkId: networkId,
            key: {
                type: 'mnemonic',
                words: secretWords
            },
        });

        const address = await (await wallet.getUnusedAddresses())[0]
        const vKey = resolvePaymentKeyHash(address)

        return {
            walletMnemonic: secretWords.join(' '),
            walletAddress: address,
            walletVkey: vKey
        }

    },
});