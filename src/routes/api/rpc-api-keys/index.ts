import { adminAuthenticatedEndpointFactory } from '@/utils/endpoint-factory/admin-authenticated';
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
        const rpcProviderKeys = await prisma.networkHandler.findMany({ cursor: input.cursorId ? { id: input.cursorId } : undefined, orderBy: { createdAt: "asc" }, take: input.limit })
        return { rpcProviderKeys: rpcProviderKeys }
    },
});