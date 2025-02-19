import { creditTokenRepository } from "@/repositories/creditTokens";
import { InsufficientFundsError } from "@/utils/errors/insufficient-funds-error";
import { logger } from "@/utils/logger";
import { Network, PaymentType } from "@prisma/client";
import createHttpError from "http-errors";
async function handlePurchaseCreditInit({ id, cost, metadata, network, blockchainIdentifier, paymentType, contractAddress, sellerVkey, submitResultTime, refundTime, unlockTime }:
    {
        id: string,
        cost: { amount: bigint, unit: string }[],
        metadata: string | null | undefined,
        network: Network,
        blockchainIdentifier: string,
        paymentType: PaymentType,
        contractAddress: string,
        sellerVkey: string,
        submitResultTime: bigint,
        refundTime: bigint,
        unlockTime: bigint,
    }
) {
    try {
        return await creditTokenRepository.handlePurchaseCreditInit({ id, cost, metadata, network, blockchainIdentifier, paymentType, contractAddress, sellerVkey, submitResultTime, unlockTime, refundTime })
    } catch (error) {
        if (error instanceof InsufficientFundsError) {
            throw createHttpError(400, "Insufficient funds")
        }
        logger.error(error)
        throw createHttpError(500, "Error handling payment credit initialization")
    }
}

export const tokenCreditService = { handlePurchaseCreditInit }