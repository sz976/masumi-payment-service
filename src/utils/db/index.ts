import { PrismaClient } from "@prisma/client";
import { logger } from "../logger";

export const prisma = new PrismaClient({
    //log: ["query", "info", "warn", "error"]
});


export async function cleanupDB() {
    await prisma.$disconnect()
}

export async function initDB() {
    await prisma.$connect()
    const paymentContracts = await prisma.paymentContract.aggregate({
        _count: true
    })
    logger.info(`Found ${paymentContracts._count} payment contract${paymentContracts._count == 1 ? "" : "s"}`)
    logger.info("Initialized database")
}
