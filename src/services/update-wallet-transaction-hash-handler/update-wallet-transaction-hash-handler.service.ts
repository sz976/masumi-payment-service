import {
  HotWalletType,
  TransactionStatus,
  PaymentAction,
  PaymentErrorType,
  PurchasingAction,
  PurchaseErrorType,
  RegistrationState,
} from '@prisma/client';
import { Sema } from 'async-sema';
import { prisma } from '@/utils/db';
import { BlockfrostProvider } from '@meshsdk/core';
import { logger } from '@/utils/logger';
import { cardanoRefundHandlerService } from '../cardano-refund-handler/cardano-collection-refund.service';
import { cardanoSubmitResultHandlerService } from '../cardano-submit-result-handler/cardano-submit-result-handler.service';
import { cardanoRequestRefundHandlerService } from '../cardano-request-refund-handler/cardano-request-refund-handler.service';
import { cardanoCollectionHandlerService } from '../cardano-collection-handler';
import { cardanoPaymentBatcherService } from '../cardano-payment-batcher';
import { cardanoRegisterHandlerService } from '../cardano-register-handler/cardano-register-handler.service';
import { cardanoDeregisterHandlerService } from '../cardano-deregister-handler/cardano-deregister-handler.service';
import { cardanoAuthorizeRefundHandlerService } from '../cardano-authorize-refund-handler/cardano-authorize-refund-handler.service';
import { cardanoCancelRefundHandlerService } from '../cardano-cancel-refund-handler/cardano-cancel-refund-handler.service';
import { DEFAULTS } from '@/utils/config';
import { convertErrorString } from '@/utils/converter/error-string-convert';
const updateMutex = new Sema(1);

export async function updateWalletTransactionHash() {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const acquiredMutex = await updateMutex.tryAcquire();
  //if we are already performing an update, we wait for it to finish and return
  if (!acquiredMutex) return (await updateMutex.acquire()) as void;
  const unlockedSellingWalletIds: string[] = [];
  const unlockedPurchasingWalletIds: string[] = [];
  try {
    await prisma.$transaction(async (prisma) => {
      const result = await prisma.paymentRequest.findMany({
        where: {
          NextAction: {
            requestedAction: {
              in: [
                PaymentAction.WithdrawInitiated,
                PaymentAction.SubmitResultInitiated,
                PaymentAction.AuthorizeRefundInitiated,
              ],
            },
          },
          OR: [
            {
              updatedAt: {
                lt: new Date(
                  Date.now() -
                    //15 minutes for timeouts, check every tx older than 1 minute
                    DEFAULTS.LOCK_TIMEOUT_INTERVAL,
                ),
              },
              CurrentTransaction: null,
            },
            {
              CurrentTransaction: {
                updatedAt: {
                  lt: new Date(
                    Date.now() -
                      //15 minutes for timeouts, check every tx older than 1 minute
                      DEFAULTS.TX_TIMEOUT_INTERVAL,
                  ),
                },
              },
            },
          ],
        },
        include: { SmartContractWallet: true },
      });
      for (const paymentRequest of result) {
        if (paymentRequest.currentTransactionId == null) {
          if (
            paymentRequest.SmartContractWallet != null &&
            paymentRequest.SmartContractWallet.pendingTransactionId == null &&
            paymentRequest.SmartContractWallet.lockedAt &&
            new Date(paymentRequest.SmartContractWallet.lockedAt) <
              new Date(Date.now() - DEFAULTS.LOCK_TIMEOUT_INTERVAL)
          )
            unlockedSellingWalletIds.push(
              paymentRequest.SmartContractWallet?.id,
            );

          await prisma.paymentRequest.update({
            where: { id: paymentRequest.id },
            data: {
              SmartContractWallet:
                paymentRequest.SmartContractWallet == null
                  ? undefined
                  : {
                      update: {
                        //we expect there not to be a pending transaction. Otherwise we do not unlock the wallet
                        lockedAt:
                          paymentRequest.SmartContractWallet
                            .pendingTransactionId == null &&
                          paymentRequest.SmartContractWallet.lockedAt &&
                          new Date(
                            paymentRequest.SmartContractWallet.lockedAt,
                          ) <
                            new Date(
                              Date.now() - DEFAULTS.LOCK_TIMEOUT_INTERVAL,
                            )
                            ? null
                            : undefined,
                      },
                    },
              NextAction: {
                update: {
                  requestedAction: PaymentAction.WaitingForExternalAction,
                  errorNote: 'Timeout when locking',
                  errorType: PaymentErrorType.Unknown,
                },
              },
            },
          });
        } else {
          if (
            (paymentRequest.SmartContractWallet?.pendingTransactionId != null &&
              paymentRequest.SmartContractWallet?.pendingTransactionId ==
                paymentRequest.currentTransactionId) ||
            (paymentRequest.SmartContractWallet?.lockedAt &&
              new Date(paymentRequest.SmartContractWallet.lockedAt) <
                new Date(Date.now() - DEFAULTS.TX_TIMEOUT_INTERVAL))
          )
            unlockedSellingWalletIds.push(
              paymentRequest.SmartContractWallet?.id,
            );

          await prisma.paymentRequest.update({
            where: { id: paymentRequest.id },
            data: {
              SmartContractWallet:
                paymentRequest.SmartContractWallet == null
                  ? undefined
                  : {
                      update: {
                        //we expect there not to be a pending transaction. Otherwise we do not unlock the wallet
                        lockedAt:
                          (paymentRequest.SmartContractWallet
                            ?.pendingTransactionId != null &&
                            paymentRequest.SmartContractWallet
                              ?.pendingTransactionId ==
                              paymentRequest.currentTransactionId) ||
                          (paymentRequest.SmartContractWallet?.lockedAt &&
                            new Date(
                              paymentRequest.SmartContractWallet.lockedAt,
                            ) <
                              new Date(
                                Date.now() - DEFAULTS.TX_TIMEOUT_INTERVAL,
                              ))
                            ? null
                            : undefined,
                        pendingTransactionId:
                          (paymentRequest.SmartContractWallet
                            ?.pendingTransactionId != null &&
                            paymentRequest.SmartContractWallet
                              ?.pendingTransactionId ==
                              paymentRequest.currentTransactionId) ||
                          (paymentRequest.SmartContractWallet?.lockedAt &&
                            new Date(
                              paymentRequest.SmartContractWallet.lockedAt,
                            ) <
                              new Date(
                                Date.now() - DEFAULTS.TX_TIMEOUT_INTERVAL,
                              ))
                            ? null
                            : undefined,
                      },
                    },
              CurrentTransaction: {
                update: {
                  status: TransactionStatus.FailedViaTimeout,
                },
              },
              NextAction: {
                update: {
                  requestedAction: PaymentAction.WaitingForExternalAction,
                  errorNote: 'Timeout when waiting for transaction',
                  errorType: PaymentErrorType.Unknown,
                },
              },
            },
          });
        }
      }
    });
  } catch (error) {
    logger.error('Error updating timed out payment requests', { error: error });
  }
  try {
    await prisma.$transaction(async (prisma) => {
      const result = await prisma.purchaseRequest.findMany({
        where: {
          NextAction: {
            requestedAction: {
              in: [
                PurchasingAction.FundsLockingInitiated,
                PurchasingAction.WithdrawRefundInitiated,
                PurchasingAction.SetRefundRequestedInitiated,
                PurchasingAction.UnSetRefundRequestedInitiated,
              ],
            },
          },
          OR: [
            {
              updatedAt: {
                lt: new Date(
                  Date.now() -
                    //15 minutes for timeouts, check every tx older than 1 minute
                    DEFAULTS.LOCK_TIMEOUT_INTERVAL,
                ),
              },
              CurrentTransaction: null,
            },
            {
              CurrentTransaction: {
                updatedAt: {
                  lt: new Date(
                    Date.now() -
                      //15 minutes for timeouts, check every tx older than 1 minute
                      DEFAULTS.TX_TIMEOUT_INTERVAL,
                  ),
                },
              },
            },
          ],
        },
        include: { SmartContractWallet: true },
      });
      for (const purchaseRequest of result) {
        if (purchaseRequest.currentTransactionId == null) {
          if (
            purchaseRequest.SmartContractWallet != null &&
            purchaseRequest.SmartContractWallet.pendingTransactionId == null &&
            purchaseRequest.SmartContractWallet.lockedAt &&
            new Date(purchaseRequest.SmartContractWallet.lockedAt) <
              new Date(Date.now() - DEFAULTS.LOCK_TIMEOUT_INTERVAL)
          )
            unlockedPurchasingWalletIds.push(
              purchaseRequest.SmartContractWallet?.id,
            );

          await prisma.purchaseRequest.update({
            where: { id: purchaseRequest.id },
            data: {
              SmartContractWallet:
                purchaseRequest.SmartContractWallet == null
                  ? undefined
                  : {
                      update: {
                        //we expect there not to be a pending transaction. Otherwise we do not unlock the wallet
                        lockedAt:
                          purchaseRequest.SmartContractWallet
                            .pendingTransactionId == null &&
                          purchaseRequest.SmartContractWallet.lockedAt &&
                          new Date(
                            purchaseRequest.SmartContractWallet.lockedAt,
                          ) <
                            new Date(
                              Date.now() - DEFAULTS.LOCK_TIMEOUT_INTERVAL,
                            )
                            ? null
                            : undefined,
                      },
                    },
              NextAction: {
                update: {
                  requestedAction: PurchasingAction.WaitingForExternalAction,
                  errorNote: 'Timeout when locking',
                  errorType: PurchaseErrorType.Unknown,
                },
              },
            },
          });
        } else {
          if (
            (purchaseRequest.SmartContractWallet?.pendingTransactionId !=
              null &&
              purchaseRequest.SmartContractWallet?.pendingTransactionId ==
                purchaseRequest.currentTransactionId) ||
            (purchaseRequest.SmartContractWallet?.lockedAt &&
              new Date(purchaseRequest.SmartContractWallet.lockedAt) <
                new Date(Date.now() - DEFAULTS.TX_TIMEOUT_INTERVAL))
          )
            unlockedPurchasingWalletIds.push(
              purchaseRequest.SmartContractWallet?.id,
            );

          await prisma.purchaseRequest.update({
            where: { id: purchaseRequest.id },
            data: {
              SmartContractWallet:
                purchaseRequest.SmartContractWallet == null
                  ? undefined
                  : {
                      update: {
                        //we expect there not to be a pending transaction. Otherwise we do not unlock the wallet
                        lockedAt:
                          (purchaseRequest.SmartContractWallet
                            ?.pendingTransactionId != null &&
                            purchaseRequest.SmartContractWallet
                              ?.pendingTransactionId ==
                              purchaseRequest.currentTransactionId) ||
                          (purchaseRequest.SmartContractWallet?.lockedAt &&
                            new Date(
                              purchaseRequest.SmartContractWallet.lockedAt,
                            ) <
                              new Date(
                                Date.now() - DEFAULTS.TX_TIMEOUT_INTERVAL,
                              ))
                            ? null
                            : undefined,
                        pendingTransactionId:
                          (purchaseRequest.SmartContractWallet
                            ?.pendingTransactionId != null &&
                            purchaseRequest.SmartContractWallet
                              ?.pendingTransactionId ==
                              purchaseRequest.currentTransactionId) ||
                          (purchaseRequest.SmartContractWallet?.lockedAt &&
                            new Date(
                              purchaseRequest.SmartContractWallet.lockedAt,
                            ) <
                              new Date(
                                Date.now() - DEFAULTS.TX_TIMEOUT_INTERVAL,
                              ))
                            ? null
                            : undefined,
                      },
                    },
              CurrentTransaction: {
                update: {
                  status: TransactionStatus.FailedViaTimeout,
                },
              },
              NextAction: {
                update: {
                  requestedAction: PurchasingAction.WaitingForExternalAction,
                  errorNote: 'Timeout when waiting for transaction',
                  errorType: PurchaseErrorType.Unknown,
                },
              },
            },
          });
        }
      }
    });
  } catch (error) {
    logger.error('Error updating timed out purchasing requests', {
      error: error,
    });
  }
  try {
    await prisma.$transaction(async (prisma) => {
      const result = await prisma.registryRequest.findMany({
        where: {
          state: {
            in: [
              RegistrationState.RegistrationInitiated,
              RegistrationState.DeregistrationInitiated,
            ],
          },
          OR: [
            {
              updatedAt: {
                lt: new Date(
                  Date.now() -
                    //15 minutes for timeouts, check every tx older than 1 minute
                    DEFAULTS.LOCK_TIMEOUT_INTERVAL,
                ),
              },
              CurrentTransaction: null,
            },
            {
              CurrentTransaction: {
                updatedAt: {
                  lt: new Date(
                    Date.now() -
                      //15 minutes for timeouts, check every tx older than 1 minute
                      DEFAULTS.TX_TIMEOUT_INTERVAL,
                  ),
                },
              },
            },
          ],
        },
        include: { SmartContractWallet: true },
      });

      for (const registryRequest of result) {
        if (registryRequest.currentTransactionId == null) {
          if (
            registryRequest.SmartContractWallet != null &&
            registryRequest.SmartContractWallet.pendingTransactionId == null &&
            registryRequest.SmartContractWallet.lockedAt &&
            new Date(registryRequest.SmartContractWallet.lockedAt) <
              new Date(Date.now() - DEFAULTS.LOCK_TIMEOUT_INTERVAL)
          )
            unlockedSellingWalletIds.push(
              registryRequest.SmartContractWallet?.id,
            );

          await prisma.registryRequest.update({
            where: { id: registryRequest.id },
            data: {
              SmartContractWallet:
                registryRequest.SmartContractWallet == null
                  ? undefined
                  : {
                      update: {
                        //we expect there not to be a pending transaction. Otherwise we do not unlock the wallet
                        lockedAt:
                          registryRequest.SmartContractWallet
                            .pendingTransactionId == null &&
                          registryRequest.SmartContractWallet.lockedAt &&
                          new Date(
                            registryRequest.SmartContractWallet.lockedAt,
                          ) <
                            new Date(
                              Date.now() - DEFAULTS.LOCK_TIMEOUT_INTERVAL,
                            )
                            ? null
                            : undefined,
                      },
                    },
              state:
                registryRequest.state == RegistrationState.RegistrationInitiated
                  ? RegistrationState.RegistrationFailed
                  : RegistrationState.DeregistrationFailed,
            },
          });
        } else {
          if (
            (registryRequest.SmartContractWallet?.pendingTransactionId !=
              null &&
              registryRequest.SmartContractWallet?.pendingTransactionId ==
                registryRequest.currentTransactionId) ||
            (registryRequest.SmartContractWallet?.lockedAt &&
              new Date(registryRequest.SmartContractWallet.lockedAt) <
                new Date(Date.now() - DEFAULTS.TX_TIMEOUT_INTERVAL))
          )
            unlockedSellingWalletIds.push(
              registryRequest.SmartContractWallet?.id,
            );

          await prisma.registryRequest.update({
            where: { id: registryRequest.id },
            data: {
              SmartContractWallet:
                registryRequest.SmartContractWallet == null
                  ? undefined
                  : {
                      update: {
                        //we expect there not to be a pending transaction. Otherwise we do not unlock the wallet
                        lockedAt:
                          (registryRequest.SmartContractWallet
                            ?.pendingTransactionId != null &&
                            registryRequest.SmartContractWallet
                              ?.pendingTransactionId ==
                              registryRequest.currentTransactionId) ||
                          (registryRequest.SmartContractWallet?.lockedAt &&
                            new Date(
                              registryRequest.SmartContractWallet.lockedAt,
                            ) <
                              new Date(
                                Date.now() - DEFAULTS.TX_TIMEOUT_INTERVAL,
                              ))
                            ? null
                            : undefined,
                        pendingTransactionId:
                          (registryRequest.SmartContractWallet
                            ?.pendingTransactionId != null &&
                            registryRequest.SmartContractWallet
                              ?.pendingTransactionId ==
                              registryRequest.currentTransactionId) ||
                          (registryRequest.SmartContractWallet?.lockedAt &&
                            new Date(
                              registryRequest.SmartContractWallet.lockedAt,
                            ) <
                              new Date(
                                Date.now() - DEFAULTS.TX_TIMEOUT_INTERVAL,
                              ))
                            ? null
                            : undefined,
                      },
                    },
              CurrentTransaction: {
                update: {
                  status: TransactionStatus.FailedViaTimeout,
                },
              },
              state:
                registryRequest.state == RegistrationState.RegistrationInitiated
                  ? RegistrationState.RegistrationFailed
                  : RegistrationState.DeregistrationFailed,
            },
          });
        }
      }
    });
  } catch (error) {
    logger.error('Error updating timed out registry requests', {
      error: error,
    });
  }
  try {
    const lockedHotWallets = await prisma.hotWallet.findMany({
      where: {
        PendingTransaction: {
          //if the transaction has been checked in the last 30 seconds, we skip it
          lastCheckedAt: {
            lte: new Date(Date.now() - 1000 * 60 * 1),
          },
        },
        OR: [
          {
            lockedAt: {
              lt: new Date(Date.now() - DEFAULTS.LOCK_TIMEOUT_INTERVAL),
            },
          },
          { lockedAt: null },
        ],
      },
      include: {
        PendingTransaction: true,
        PaymentSource: {
          include: { PaymentSourceConfig: true },
        },
      },
    });

    await Promise.allSettled(
      lockedHotWallets.map(async (wallet) => {
        try {
          if (wallet.PendingTransaction == null) {
            logger.error(
              `Wallet ${wallet.id} has no pending transaction when expected. Skipping...`,
            );
            return;
          }
          const txHash = wallet.PendingTransaction.txHash;

          const blockfrostKey =
            wallet.PaymentSource.PaymentSourceConfig.rpcProviderApiKey;
          const provider = new BlockfrostProvider(blockfrostKey);
          const txInfo = await provider.fetchTxInfo(txHash);
          if (txInfo) {
            await prisma.hotWallet.update({
              where: { id: wallet.id },
              data: {
                PendingTransaction: { disconnect: true },
                lockedAt: null,
              },
            });
            if (wallet.type == HotWalletType.Selling) {
              unlockedSellingWalletIds.push(wallet.id);
            } else if (wallet.type == HotWalletType.Purchasing) {
              unlockedPurchasingWalletIds.push(wallet.id);
            }
          } else {
            await prisma.transaction.update({
              where: { id: wallet.PendingTransaction.id },
              data: { lastCheckedAt: new Date() },
            });
          }
        } catch (error) {
          logger.error(
            `Error updating wallet transaction hash: ${convertErrorString(error)}`,
          );
        }
      }),
    );

    const timedOutLockedHotWallets = await prisma.hotWallet.findMany({
      where: {
        lockedAt: { lt: new Date(Date.now() - DEFAULTS.LOCK_TIMEOUT_INTERVAL) },
        PendingTransaction: null,
      },
      include: {
        PaymentSource: { include: { PaymentSourceConfig: true } },
      },
    });
    await Promise.allSettled(
      timedOutLockedHotWallets.map(async (wallet) => {
        try {
          await prisma.hotWallet.update({
            where: { id: wallet.id },
            data: {
              lockedAt: null,
            },
          });

          if (wallet.type == HotWalletType.Selling) {
            unlockedSellingWalletIds.push(wallet.id);
          } else if (wallet.type == HotWalletType.Purchasing) {
            unlockedPurchasingWalletIds.push(wallet.id);
          }
        } catch (error) {
          logger.error(
            `Error updating timed out wallet: ${convertErrorString(error)}`,
          );
        }
      }),
    );
    const uniqueUnlockedSellingWalletIds = [
      ...new Set(unlockedSellingWalletIds),
    ].filter((id) => id != null);
    const uniqueUnlockedPurchasingWalletIds = [
      ...new Set(unlockedPurchasingWalletIds),
    ].filter((id) => id != null);
    //TODO: reset initialized actions
    if (uniqueUnlockedSellingWalletIds.length > 0) {
      try {
        await cardanoSubmitResultHandlerService.submitResultV1();
      } catch (error) {
        logger.error(`Error initiating refunds: ${convertErrorString(error)}`);
      }
      try {
        await cardanoAuthorizeRefundHandlerService.authorizeRefundV1();
      } catch (error) {
        logger.error(`Error initiating refunds: ${convertErrorString(error)}`);
      }
      try {
        await cardanoCollectionHandlerService.collectOutstandingPaymentsV1();
      } catch (error) {
        logger.error(`Error initiating refunds: ${convertErrorString(error)}`);
      }
      try {
        await cardanoRegisterHandlerService.registerAgentV1();
      } catch (error) {
        logger.error(
          `Error initiating timeout refunds: ${convertErrorString(error)}`,
        );
      }
      try {
        await cardanoDeregisterHandlerService.deRegisterAgentV1();
      } catch (error) {
        logger.error(
          `Error initiating timeout refunds: ${convertErrorString(error)}`,
        );
      }
    }
    if (uniqueUnlockedPurchasingWalletIds.length > 0) {
      try {
        await cardanoRefundHandlerService.collectRefundV1();
      } catch (error) {
        logger.error(
          `Error initiating timeout refunds: ${convertErrorString(error)}`,
        );
      }
      try {
        await cardanoRequestRefundHandlerService.requestRefundsV1();
      } catch (error) {
        logger.error(
          `Error initiating timeout refunds: ${convertErrorString(error)}`,
        );
      }
      try {
        await cardanoCancelRefundHandlerService.cancelRefundsV1();
      } catch (error) {
        logger.error(
          `Error initiating timeout refunds: ${convertErrorString(error)}`,
        );
      }
      try {
        await cardanoPaymentBatcherService.batchLatestPaymentEntriesV1();
      } catch (error) {
        logger.error(`Error initiating refunds: ${convertErrorString(error)}`);
      }
    }
    try {
      const errorHotWallets = await prisma.hotWallet.findMany({
        where: { PendingTransaction: { isNot: null }, lockedAt: null },
        include: { PendingTransaction: true },
      });
      for (const hotWallet of errorHotWallets) {
        logger.error(
          `Hot wallet ${hotWallet.id} was in an invalid locked state (this is likely a bug please report it with the following transaction hash): ${hotWallet.PendingTransaction?.txHash}`,
        );
        await prisma.hotWallet.update({
          where: { id: hotWallet.id },
          data: {
            lockedAt: null,
            PendingTransaction: { disconnect: true },
          },
        });
      }
    } catch (error) {
      logger.error(`Error updating wallet transaction hash`, { error: error });
    }
  } catch (error) {
    logger.error(`Error updating wallet transaction hash`, { error: error });
  } finally {
    //library is strange as we can release from any non-acquired semaphore
    updateMutex.release();
  }
}

export const updateWalletTransactionHashHandlerService = {
  updateWalletTransactionHash,
};
