import { adminAuthenticatedEndpointFactory } from '@/utils/security/auth/admin-authenticated';
import { z } from 'zod';
import { ApiKeyStatus, Network, Permission } from '@prisma/client';
import { prisma } from '@/utils/db';
import { createId } from '@paralleldrive/cuid2';
import createHttpError from 'http-errors';


export const getAPIKeySchemaInput = z.object({
    limit: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of API keys to return"),
    cursorApiKey: z.string().max(550).optional().describe("Used to paginate through the API keys")
})


export const getAPIKeySchemaOutput = z.object({
    apiKeys: z.array(z.object({
        token: z.string(),
        permission: z.nativeEnum(Permission),
        usageLimited: z.boolean(),
        networkLimit: z.array(z.nativeEnum(Network)),
        RemainingUsageCredits: z.array(z.object({
            unit: z.string(),
            amount: z.string()
        })),
        status: z.nativeEnum(ApiKeyStatus),
    }))
});

export const queryAPIKeyEndpointGet = adminAuthenticatedEndpointFactory.build({
    method: "get",
    input: getAPIKeySchemaInput,
    output: getAPIKeySchemaOutput,
    handler: async ({ input, }) => {
        const result = await prisma.apiKey.findMany({ where: {}, cursor: input.cursorApiKey ? { token: input.cursorApiKey } : undefined, take: input.limit, include: { RemainingUsageCredits: true } })
        return { apiKeys: result.map((data) => { return { ...data, RemainingUsageCredits: data.RemainingUsageCredits.map((usageCredit) => ({ unit: usageCredit.unit, amount: usageCredit.amount.toString() })) } }) }
    },
});

export const addAPIKeySchemaInput = z.object({
    usageLimited: z.string().transform((s) => s.toLowerCase() == "true" ? true : false).default("true").describe("Whether the API key is usage limited. Meaning only allowed to use the specified credits or can freely spend"),
    UsageCredits: z.array(z.object({
        unit: z.string().max(150),
        amount: z.string()
    })).describe("The credits allowed to be used by the API key. Only relevant if usageLimited is true. "),
    networkLimit: z.array(z.nativeEnum(Network)).max(3).default([Network.Mainnet, Network.Preprod]).describe("The networks the API key is allowed to use"),
    permission: z.nativeEnum(Permission).default(Permission.Read).describe("The permission of the API key"),
})

export const addAPIKeySchemaOutput = z.object({
    id: z.string(),
    token: z.string(),
    permission: z.nativeEnum(Permission),
    usageLimited: z.boolean(),
    networkLimit: z.array(z.nativeEnum(Network)),
    status: z.nativeEnum(ApiKeyStatus),
})

export const addAPIKeyEndpointPost = adminAuthenticatedEndpointFactory.build({
    method: "post",
    input: addAPIKeySchemaInput,
    output: addAPIKeySchemaOutput,
    handler: async ({ input }) => {
        const apiKey = ("masumi-payment-" + input.permission == Permission.Admin ? "admin-" : "") + createId()
        const result = await prisma.apiKey.create({
            data: {
                token: apiKey,
                status: ApiKeyStatus.Active,
                permission: input.permission,
                usageLimited: input.usageLimited,
                networkLimit: input.networkLimit,
                RemainingUsageCredits: {
                    createMany: {
                        data: input.UsageCredits.map((usageCredit) => {
                            const parsedAmount = BigInt(usageCredit.amount)
                            if (parsedAmount < 0) {
                                throw createHttpError(400, "Invalid amount")
                            }
                            return { unit: usageCredit.unit, amount: parsedAmount }
                        })
                    }
                }
            }
        })
        return result
    },
});

export const updateAPIKeySchemaInput = z.object({
    id: z.string().max(150).optional().describe("The id of the API key to update. Provide either id or apiKey"),
    token: z.string().max(550).optional().describe("The API key to update. Provide either id or apiKey"),
    UsageCredits: z.array(z.object({
        unit: z.string().max(150),
        amount: z.string()
    })).optional().describe("The remaining credits allowed to be used by the API key. Only relevant if usageLimited is true. "),
    status: z.nativeEnum(ApiKeyStatus).default(ApiKeyStatus.Active).optional().describe("The status of the API key"),
    networkLimit: z.array(z.nativeEnum(Network)).max(3).default([Network.Mainnet, Network.Preprod]).optional().describe("The networks the API key is allowed to use"),
})

export const updateAPIKeySchemaOutput = z.object({
    id: z.string(),
    token: z.string(),
    permission: z.nativeEnum(Permission),
    networkLimit: z.array(z.nativeEnum(Network)),
    usageLimited: z.boolean(),
    status: z.nativeEnum(ApiKeyStatus),
})

export const updateAPIKeyEndpointPatch = adminAuthenticatedEndpointFactory.build({
    method: "patch",
    input: updateAPIKeySchemaInput,
    output: updateAPIKeySchemaOutput,
    handler: async ({ input }) => {
        if (input.id) {
            const result = await prisma.apiKey.update({
                where: { id: input.id }, data: {
                    usageLimited: input.usageLimited,
                    status: input.status,
                    networkLimit: input.networkLimit,
                    RemainingUsageCredits: {
                        set: input.UsageCredits?.map((usageCredit) => {
                            const parsedAmount = BigInt(usageCredit.amount)
                            if (parsedAmount < 0) {
                                throw createHttpError(400, "Invalid amount")
                            }
                            return {
                                id: createId(), unit: usageCredit.unit, amount: parsedAmount
                            }
                        })
                    }
                }
            })
            return result
        } else if (input.token) {
            const result = await prisma.apiKey.update({
                where: { token: input.token }, data: {
                    usageLimited: input.usageLimited,
                    status: input.status,
                    networkLimit: input.networkLimit,
                    RemainingUsageCredits: {
                        set: input.UsageCredits?.map((usageCredit) => {
                            const parsedAmount = BigInt(usageCredit.amount)
                            if (parsedAmount < 0) {
                                throw createHttpError(400, "Invalid amount")
                            }
                            return { id: createId(), unit: usageCredit.unit, amount: parsedAmount }
                        })
                    }
                }
            })
            return result;
        }
        throw createHttpError(400, "Invalid input")
    },
});

export const deleteAPIKeySchemaInput = z.object({
    id: z.string().max(150).optional().describe("The id of the API key to delete. Provide either id or apiKey"),
    token: z.string().max(550).optional().describe("The API key to delete. Provide either id or apiKey"),
})

export const deleteAPIKeySchemaOutput = z.object({
    id: z.string(),
    token: z.string(),
});

export const deleteAPIKeyEndpointDelete = adminAuthenticatedEndpointFactory.build({
    method: "delete",
    input: deleteAPIKeySchemaInput,
    output: deleteAPIKeySchemaOutput,

    handler: async ({ input, }) => {
        if (input.id) {
            const result = await prisma.apiKey.update({ where: { id: input.id }, data: { deletedAt: new Date(), status: ApiKeyStatus.Revoked } })
            return result
        } else if (input.token) {
            const result = await prisma.apiKey.update({ where: { token: input.token }, data: { deletedAt: new Date(), status: ApiKeyStatus.Revoked } })
            return result
        }
        throw createHttpError(400, "Invalid input")
    },
});
