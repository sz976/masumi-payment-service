import { prisma } from '@/utils/db';
import { authenticatedEndpointFactory } from '@/utils/endpoint-factory/authenticated';
import { $Enums } from '@prisma/client';
import { z } from 'zod';

export const paymentContractSchemaInput = z.object({
    take: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of payment sources to return"),
    cursorId: z.string().max(250).optional().describe("Used to paginate through the payment sources"),
});
export const paymentContractSchemaOutput = z.object({
    paymentSources: z.array(z.object({
        id: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        network: z.nativeEnum($Enums.Network),
        paymentContractAddress: z.string(),
        paymentType: z.nativeEnum($Enums.PaymentType),
        lastIdentifierChecked: z.string().nullable(),
        lastPageChecked: z.number(),
        lastCheckedAt: z.date().nullable(),
        AdminWallets: z.array(z.object({
            walletAddress: z.string(),
            order: z.number(),
        })),
        CollectionWallet: z.object({
            id: z.string(),
            walletAddress: z.string(),
            note: z.string().nullable(),
        }).nullable(),
        PurchasingWallets: z.array(z.object({
            id: z.string(),
            walletVkey: z.string(),
            walletAddress: z.string(),
            note: z.string().nullable(),
        })),
        SellingWallets: z.array(z.object({
            id: z.string(),
            walletVkey: z.string(),
            walletAddress: z.string(),
            note: z.string().nullable(),
        })),
        FeeReceiverNetworkWallet: z.object({
            walletAddress: z.string(),
        }),
        feePermille: z.number().min(0).max(1000),
    })),
});

export const paymentContractEndpointGet = authenticatedEndpointFactory.build({
    method: "get",
    input: paymentContractSchemaInput,
    output: paymentContractSchemaOutput,
    handler: async ({ input }) => {
        const paymentSources = await prisma.networkHandler.findMany({
            take: input.take,
            orderBy: {
                createdAt: "desc"
            },
            cursor: input.cursorId ? { id: input.cursorId } : undefined,
            include: {
                AdminWallets: { orderBy: { order: "asc" } },
                CollectionWallet: true,
                PurchasingWallets: true,
                SellingWallets: true,
                FeeReceiverNetworkWallet: true,
            }
        })
        return { paymentSources: paymentSources }
    },
});
