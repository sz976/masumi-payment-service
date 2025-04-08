import { PrismaClient } from '@prisma/client';
import { logger } from '../logger';

export const prisma = new PrismaClient({
  //log: ["query", "info", "warn", "error"]
});

export async function cleanupDB() {
  await prisma.$disconnect();
}

export async function initDB() {
  await prisma.$connect();
  const paymentSources = await prisma.paymentSource.aggregate({
    _count: true,
  });
  logger.info(
    `Found ${paymentSources._count} payment source${paymentSources._count == 1 ? '' : 's'}`,
  );
  logger.info('Initialized database');
}
