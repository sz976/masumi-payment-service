import { adminAuthenticatedEndpointFactory } from '@/utils/security/auth/admin-authenticated';
import { z } from 'zod';
import { prisma } from '@/utils/db';
import { $Enums } from '@prisma/client';




export const getRpcProviderKeysSchemaInput = z.object({
    cursorId: z.string().min(1).max(250).optional().describe("Used to paginate through the rpc provider keys"),
    limit: z.number({ coerce: true }).min(1).max(100).default(100).describe("The number of rpc provider keys to return"),
})


export const getRpcProviderKeysSchemaOutput = z.object({
    rpcProviderKeys: z.array(z.object({
        id: z.string(),
        rpcProviderApiKey: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        network: z.nativeEnum($Enums.Network),
    })),
});

export const queryRpcProviderKeysEndpointGet = adminAuthenticatedEndpointFactory.build({
    method: "get",
    input: getRpcProviderKeysSchemaInput,
    output: getRpcProviderKeysSchemaOutput,
    handler: async ({ input }) => {
        const rpcProviderKeys = await prisma.networkHandlerConfig.findMany({
            cursor: input.cursorId ? { id: input.cursorId } : undefined, take: input.limit, orderBy: { createdAt: "asc" },
            where: {
                NetworkHandler: {
                    isNot: null
                }
            },
            include: {
                NetworkHandler: true
            }
        })
        return {
            rpcProviderKeys: rpcProviderKeys.map((rpcProviderKey) => ({
                id: rpcProviderKey.id,
                rpcProviderApiKey: rpcProviderKey.rpcProviderApiKey,
                createdAt: rpcProviderKey.createdAt,
                updatedAt: rpcProviderKey.updatedAt,
                network: rpcProviderKey.NetworkHandler!.network
            }))
        }
    },
});