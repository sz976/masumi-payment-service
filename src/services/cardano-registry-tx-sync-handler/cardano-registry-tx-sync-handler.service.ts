import {
  PaymentType,
  RegistrationState,
  TransactionStatus,
} from '@prisma/client';
import { prisma } from '@/utils/db';
import { logger } from '@/utils/logger';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { advancedRetryAll, delayErrorResolver } from 'advanced-retry';
import { convertNetwork } from '@/utils/converter/network-convert';
import { Mutex, MutexInterface, tryAcquire } from 'async-mutex';

const mutex = new Mutex();

export async function checkRegistryTransactions() {
  let release: MutexInterface.Releaser | null;
  try {
    release = await tryAcquire(mutex).acquire();
  } catch (e) {
    logger.info('Mutex timeout when locking', { error: e });
    return;
  }

  try {
    //only support web3 cardano v1 for now
    const paymentContracts = await getPaymentSourcesForSync();
    if (paymentContracts.length == 0) {
      logger.warn(
        'No payment contracts found, skipping update. It could be that an other instance is already syncing',
      );
      return;
    }

    try {
      const results = await Promise.allSettled(
        paymentContracts.map(async (paymentContract) => {
          const blockfrost = new BlockFrostAPI({
            projectId: paymentContract.PaymentSourceConfig.rpcProviderApiKey,
            network: convertNetwork(paymentContract.network),
          });

          const registryRequests = await getRegistrationRequestsToSync(
            paymentContract.id,
          );
          await syncRegistryRequests(registryRequests, blockfrost);
        }),
      );

      const failedResults = results.filter((x) => x.status == 'rejected');
      if (failedResults.length > 0) {
        logger.error('Error updating registry requests', {
          error: failedResults,
          paymentContract: paymentContracts,
        });
      }
    } catch (error) {
      logger.error('Error checking latest transactions', { error: error });
    }
  } catch (error) {
    logger.error('Error checking latest transactions', { error: error });
  } finally {
    release();
  }
}

async function syncRegistryRequests(
  registryRequests: Array<{
    id: string;
    state: RegistrationState;
    CurrentTransaction: { BlocksWallet: { id: string } | null } | null;
    agentIdentifier: string | null;
  }>,
  blockfrost: BlockFrostAPI,
) {
  const results = await advancedRetryAll({
    operations: registryRequests.map((registryRequest) => async () => {
      const owner = await blockfrost.assetsAddresses(
        registryRequest.agentIdentifier!,
        { order: 'desc' },
      );

      if (registryRequest.state == RegistrationState.RegistrationInitiated) {
        if (owner.length >= 1 && owner[0].quantity == '1') {
          await prisma.registryRequest.update({
            where: { id: registryRequest.id },
            data: {
              state: RegistrationState.RegistrationConfirmed,
              CurrentTransaction: {
                update: {
                  status: TransactionStatus.Confirmed,
                  BlocksWallet:
                    registryRequest.CurrentTransaction?.BlocksWallet != null
                      ? { disconnect: true }
                      : undefined,
                },
              },
            },
          });
          if (registryRequest.CurrentTransaction?.BlocksWallet != null) {
            await prisma.hotWallet.update({
              where: {
                id: registryRequest.CurrentTransaction.BlocksWallet.id,
                deletedAt: null,
              },
              data: {
                lockedAt: null,
              },
            });
          }
        } else {
          await prisma.registryRequest.update({
            where: { id: registryRequest.id },
            data: {
              updatedAt: new Date(),
            },
          });
        }
      } else if (
        registryRequest.state == RegistrationState.DeregistrationInitiated
      ) {
        if (owner.length == 0 || owner[0].quantity == '0') {
          await prisma.registryRequest.update({
            where: { id: registryRequest.id },
            data: {
              state: RegistrationState.DeregistrationConfirmed,
              CurrentTransaction: {
                update: {
                  status: TransactionStatus.Confirmed,
                  BlocksWallet:
                    registryRequest.CurrentTransaction?.BlocksWallet != null
                      ? { disconnect: true }
                      : undefined,
                },
              },
            },
          });
          if (registryRequest.CurrentTransaction?.BlocksWallet != null) {
            await prisma.hotWallet.update({
              where: {
                id: registryRequest.CurrentTransaction.BlocksWallet.id,
                deletedAt: null,
              },
              data: {
                lockedAt: null,
              },
            });
          }
        } else {
          await prisma.registryRequest.update({
            where: { id: registryRequest.id },
            data: {
              updatedAt: new Date(),
            },
          });
        }
      }
    }),
    errorResolvers: [
      delayErrorResolver({
        configuration: {
          maxRetries: 5,
          backoffMultiplier: 2,
          initialDelayMs: 500,
          maxDelayMs: 1500,
        },
      }),
    ],
  });
  results.forEach((x) => {
    if (x.success == false) {
      logger.warn('Failed to update registry request', {
        error: x.error,
      });
    }
  });
}

async function getRegistrationRequestsToSync(paymentContractId: string) {
  return await prisma.registryRequest.findMany({
    where: {
      PaymentSource: {
        id: paymentContractId,
      },
      state: {
        in: [
          RegistrationState.RegistrationInitiated,
          RegistrationState.DeregistrationInitiated,
        ],
      },
      CurrentTransaction: {
        isNot: null,
      },
      agentIdentifier: { not: null },
      updatedAt: {
        lt: new Date(
          Date.now() -
            //15 minutes for timeouts, check every tx older than 1 minute
            1000 * 60 * 1,
        ),
      },
    },
    include: {
      CurrentTransaction: { include: { BlocksWallet: true } },
    },
  });
}

async function getPaymentSourcesForSync() {
  return await prisma.paymentSource.findMany({
    where: {
      paymentType: PaymentType.Web3CardanoV1,
      deletedAt: null,
      disableSyncAt: null,
    },
    include: {
      PaymentSourceConfig: true,
    },
  });
}
