import { authenticatedEndpointFactory } from '@/utils/endpoint-factory/authenticated';
import { z } from 'zod';
import { Network } from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';



export const getUTXOSchemaInput = z.object({
    address: z.string().max(150).describe("The address to get the UTXOs for"),
    network: z.nativeEnum(Network),
    count: z.number({ coerce: true }).int().min(1).max(100).describe("The number of UTXOs to get"),
    page: z.number({ coerce: true }).int().min(1).max(100).optional().describe("The page number to get"),
    order: z.enum(["asc", "desc"]).optional().describe("The order to get the UTXOs in"),
})


export const getUTXOSchemaOutput = z.object({
    utxos: z.array(z.object({
        txHash: z.string(),
        address: z.string(),
        amount: z.object({
            unit: z.string(),
            quantity: z.string()
        }),
        data_hash: z.string().optional(),
        inline_datum: z.string().optional(),
        reference_script_hash: z.string().optional(),
        output_index: z.number({ coerce: true }).int().min(0).max(100000000),
        block: z.number({ coerce: true }).int().min(0).max(100000000),
    }))
});

export const queryUTXOEndpointGet = authenticatedEndpointFactory.build({
    method: "get",
    input: getUTXOSchemaInput,
    output: getUTXOSchemaOutput,
    handler: async ({ input }) => {
        const result = await prisma.networkHandler.findFirst({ where: { network: input.network } })
        if (result == null) {
            throw createHttpError(404, "Network not found")
        }
        const blockfrost = new BlockFrostAPI({ projectId: result.rpcProviderApiKey })
        const utxos = await blockfrost.addressesUtxos(input.address, { count: input.count, page: input.page, order: input.order })
        return { utxos: utxos.map((utxo) => ({ txHash: utxo.tx_hash, address: utxo.address, amount: { unit: utxo.amount[0].unit, quantity: utxo.amount[0].quantity }, output_index: utxo.output_index, block: parseInt(utxo.block) })) }
    },
});