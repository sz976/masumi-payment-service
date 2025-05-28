import {
  HotWallet,
  HotWalletType,
  PurchaseErrorType,
  PurchasingAction,
  TransactionStatus,
} from '@prisma/client';
import { prisma } from '@/utils/db';
import {
  BlockfrostProvider,
  Transaction,
  resolvePaymentKeyHash,
} from '@meshsdk/core';
import { logger } from '@/utils/logger';
import { generateWalletExtended } from '@/utils/generator/wallet-generator';
import {
  getDatum,
  SmartContractState,
} from '@/utils/generator/contract-generator';
import { convertNetwork } from '@/utils/converter/network-convert';
import { convertErrorString } from '@/utils/converter/error-string-convert';
import { Mutex, MutexInterface, tryAcquire } from 'async-mutex';
import cbor from 'cbor';

const mutex = new Mutex();

export async function batchLatestPaymentEntriesV1() {
  const maxBatchSize = 10;

  let release: MutexInterface.Releaser | null;
  try {
    release = await tryAcquire(mutex).acquire();
  } catch (e) {
    logger.info('Mutex timeout when locking', { error: e });
    return;
  }

  try {
    const paymentContractsWithWalletLocked = await prisma.$transaction(
      async (prisma) => {
        const paymentContracts = await prisma.paymentSource.findMany({
          where: {
            deletedAt: null,
            HotWallets: {
              some: {
                PendingTransaction: null,
                type: HotWalletType.Purchasing,
                deletedAt: null,
              },
            },
          },
          include: {
            PurchaseRequests: {
              where: {
                NextAction: {
                  requestedAction: PurchasingAction.FundsLockingRequested,
                  errorType: null,
                },
                CurrentTransaction: { is: null },
                onChainState: null,
              },
              include: {
                PaidFunds: true,
                SellerWallet: true,
                SmartContractWallet: { where: { deletedAt: null } },
                NextAction: true,
                CurrentTransaction: true,
              },
            },
            PaymentSourceConfig: true,
            HotWallets: {
              where: {
                PendingTransaction: null,
                lockedAt: null,
                type: HotWalletType.Purchasing,
                deletedAt: null,
              },
              include: {
                Secret: true,
              },
            },
          },
        });

        const walletsToLock: HotWallet[] = [];
        const paymentContractsToUse = [];
        for (const paymentContract of paymentContracts) {
          const purchaseRequests = [];
          for (const purchaseRequest of paymentContract.PurchaseRequests) {
            //if the purchase request times out in less than 5 minutes, we ignore it
            const maxSubmitResultTime = Date.now() - 1000 * 60 * 5;
            if (purchaseRequest.submitResultTime < maxSubmitResultTime) {
              logger.info(
                'Purchase request times out in less than 5 minutes, ignoring',
                { purchaseRequest: purchaseRequest },
              );
              await prisma.purchaseRequest.update({
                where: { id: purchaseRequest.id },
                data: {
                  NextAction: {
                    create: {
                      inputHash: purchaseRequest.inputHash,
                      requestedAction: PurchasingAction.FundsLockingRequested,
                      errorType: PurchaseErrorType.Unknown,
                      errorNote: 'Transaction timeout before sending',
                    },
                  },
                },
              });
              continue;
            }
            purchaseRequests.push(purchaseRequest);
          }
          if (purchaseRequests.length == 0) {
            continue;
          }
          paymentContract.PurchaseRequests = purchaseRequests;
          for (const wallet of paymentContract.HotWallets) {
            if (!walletsToLock.some((w) => w.id === wallet.id)) {
              walletsToLock.push(wallet);
              await prisma.hotWallet.update({
                where: { id: wallet.id, deletedAt: null },
                data: { lockedAt: new Date() },
              });
            }
          }
          if (paymentContract.PurchaseRequests.length > 0) {
            paymentContractsToUse.push(paymentContract);
          }
        }
        return paymentContractsToUse;
      },
      { isolationLevel: 'Serializable', maxWait: 10000, timeout: 10000 },
    );

    await Promise.allSettled(
      paymentContractsWithWalletLocked.map(async (paymentContract) => {
        const paymentRequests = paymentContract.PurchaseRequests;
        if (paymentRequests.length == 0) {
          logger.info(
            'No payment requests found for network ' +
              paymentContract.network +
              ' ' +
              paymentContract.smartContractAddress,
          );
          return;
        }

        const potentialWallets = paymentContract.HotWallets;
        if (potentialWallets.length == 0) {
          logger.warn('No unlocked wallet to batch payments, skipping');
          return;
        }

        const walletAmounts = await Promise.all(
          potentialWallets.map(async (wallet) => {
            const { wallet: meshWallet } = await generateWalletExtended(
              paymentContract.network,
              paymentContract.PaymentSourceConfig.rpcProviderApiKey,
              wallet.Secret.encryptedMnemonic,
            );
            const amounts = await meshWallet.getBalance();
            return {
              wallet: meshWallet,
              walletId: wallet.id,
              scriptAddress: paymentContract.smartContractAddress,
              amounts: amounts.map((amount) => ({
                unit:
                  amount.unit.toLowerCase() == 'lovelace' ? '' : amount.unit,
                quantity: BigInt(amount.quantity),
              })),
            };
          }),
        );
        const paymentRequestsRemaining = [...paymentRequests];
        const walletPairings = [];

        let maxBatchSizeReached = false;

        const blockchainProvider = new BlockfrostProvider(
          paymentContract.PaymentSourceConfig.rpcProviderApiKey,
        );

        const protocolParameter =
          await blockchainProvider.fetchProtocolParameters();

        for (const walletData of walletAmounts) {
          const wallet = walletData.wallet;
          const amounts = walletData.amounts;
          const potentialAddresses = await wallet.getUsedAddresses();
          if (potentialAddresses.length == 0) {
            logger.warn('No addresses found for wallet ' + walletData.walletId);
            continue;
          }
          const batchedPaymentRequests = [];

          let index = 0;
          while (
            paymentRequestsRemaining.length > 0 &&
            index < paymentRequestsRemaining.length
          ) {
            if (batchedPaymentRequests.length >= maxBatchSize) {
              maxBatchSizeReached = true;
              break;
            }
            const paymentRequest = paymentRequestsRemaining[index];
            const sellerVerificationKeyHash =
              paymentRequest.SellerWallet.walletVkey;
            const buyerVerificationKeyHash = resolvePaymentKeyHash(
              potentialAddresses[0],
            );
            const tmpDatum = getDatum({
              buyerVerificationKeyHash: buyerVerificationKeyHash,
              sellerVerificationKeyHash: sellerVerificationKeyHash,
              blockchainIdentifier: paymentRequest.blockchainIdentifier,
              inputHash: paymentRequest.inputHash,
              resultHash: '',
              resultTime: Number(paymentRequest.submitResultTime),
              unlockTime: Number(paymentRequest.unlockTime),
              externalDisputeUnlockTime: Number(
                paymentRequest.externalDisputeUnlockTime,
              ),
              newCooldownTimeSeller: 0,
              newCooldownTimeBuyer: 0,
              state: SmartContractState.FundsLocked,
            });

            const cborEncodedDatum = cbor.encode(tmpDatum.value);

            const defaultOverheadSize = 200;
            const bufferSizeTxOutputHash = 70;
            const bufferSizeCooldownTime = 10;
            const bufferSizePerUnit = 50;

            const otherUnits = paymentRequest.PaidFunds.filter(
              (amount) =>
                amount.unit.toLowerCase() != '' &&
                amount.unit.toLowerCase() != 'lovelace',
            ).length;
            const totalLength =
              cborEncodedDatum.byteLength +
              defaultOverheadSize +
              bufferSizeTxOutputHash +
              bufferSizeCooldownTime +
              bufferSizePerUnit * otherUnits;
            const overestimatedMinUtxoCost = BigInt(
              Math.ceil(protocolParameter.coinsPerUtxoSize * totalLength),
            );

            //set min ada required;
            const lovelaceRequired = paymentRequest.PaidFunds.findIndex(
              (amount) => amount.unit.toLowerCase() === '',
            );
            if (lovelaceRequired == -1) {
              paymentRequest.PaidFunds.push({
                unit: '',
                amount: overestimatedMinUtxoCost,
                id: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                paymentRequestId: null,
                purchaseRequestId: null,
                apiKeyId: null,
                agentFixedPricingId: null,
                sellerWithdrawnPaymentRequestId: null,
                buyerWithdrawnPaymentRequestId: null,
                buyerWithdrawnPurchaseRequestId: null,
                sellerWithdrawnPurchaseRequestId: null,
              });
            } else if (
              paymentRequest.PaidFunds[lovelaceRequired].amount <
              overestimatedMinUtxoCost
            ) {
              paymentRequest.PaidFunds.splice(lovelaceRequired, 1);
              paymentRequest.PaidFunds.push({
                unit: '',
                amount: overestimatedMinUtxoCost,
                id: '',
                createdAt: new Date(),
                updatedAt: new Date(),
                paymentRequestId: null,
                purchaseRequestId: null,
                apiKeyId: null,
                agentFixedPricingId: null,
                sellerWithdrawnPaymentRequestId: null,
                buyerWithdrawnPaymentRequestId: null,
                buyerWithdrawnPurchaseRequestId: null,
                sellerWithdrawnPurchaseRequestId: null,
              });
            }
            let isFulfilled = true;
            for (const paymentAmount of paymentRequest.PaidFunds) {
              const walletAmount = amounts.find(
                (amount) => amount.unit == paymentAmount.unit,
              );
              if (
                walletAmount == null ||
                paymentAmount.amount > walletAmount.quantity
              ) {
                isFulfilled = false;
                break;
              }
            }
            if (isFulfilled) {
              batchedPaymentRequests.push(paymentRequest);
              //deduct amounts from wallet
              for (const paymentAmount of paymentRequest.PaidFunds) {
                const walletAmount = amounts.find(
                  (amount) => amount.unit == paymentAmount.unit,
                );
                walletAmount!.quantity -= paymentAmount.amount;
              }
              paymentRequestsRemaining.splice(index, 1);
            } else {
              index++;
            }
          }

          walletPairings.push({
            wallet: wallet,
            scriptAddress: walletData.scriptAddress,
            walletId: walletData.walletId,
            batchedRequests: batchedPaymentRequests,
          });
        }
        //only go into error state if we did not reach max batch size, as otherwise we might have enough funds in other wallets
        if (paymentRequestsRemaining.length > 0 && maxBatchSizeReached == false)
          await Promise.allSettled(
            paymentRequestsRemaining.map(async (paymentRequest) => {
              await prisma.purchaseRequest.update({
                where: { id: paymentRequest.id },
                data: {
                  NextAction: {
                    create: {
                      inputHash: paymentRequest.inputHash,
                      requestedAction: PurchasingAction.WaitingForManualAction,
                      errorType: PurchaseErrorType.InsufficientFunds,
                      errorNote: 'Not enough funds in wallets',
                    },
                  },
                },
              });
            }),
          );

        logger.info(
          `Batching ${walletPairings.length} payments for payment source ${paymentContract.id}`,
        );
        //do not retry, we want to fail if anything goes wrong. There should not be a possibility to pay twice
        const results = await Promise.allSettled(
          walletPairings.map(async (walletPairing) => {
            const wallet = walletPairing.wallet;
            const walletId = walletPairing.walletId;
            const utxos = await wallet.getUtxos();
            const batchedRequests = walletPairing.batchedRequests;
            const collateralUtxo = utxos
              .sort((a, b) => {
                const aLovelace = parseInt(
                  a.output.amount.find(
                    (asset) => asset.unit == 'lovelace' || asset.unit == '',
                  )?.quantity ?? '0',
                );
                const bLovelace = parseInt(
                  b.output.amount.find(
                    (asset) => asset.unit == 'lovelace' || asset.unit == '',
                  )?.quantity ?? '0',
                );
                return aLovelace - bLovelace;
              })
              .find(
                (utxo) =>
                  utxo.output.amount.length == 1 &&
                  (utxo.output.amount[0].unit == 'lovelace' ||
                    utxo.output.amount[0].unit == '') &&
                  parseInt(utxo.output.amount[0].quantity) >= 3000000 &&
                  parseInt(utxo.output.amount[0].quantity) <= 20000000,
              );
            if (!collateralUtxo) {
              throw new Error('No collateral UTXO found');
            }
            //batch payments
            const unsignedTx = new Transaction({
              initiator: wallet,
              fetcher: blockchainProvider,
            }).setMetadata(674, {
              msg: ['Masumi', 'PaymentBatched'],
            });
            for (const paymentRequest of batchedRequests) {
              const buyerVerificationKeyHash = resolvePaymentKeyHash(
                wallet.getUsedAddress().toBech32(),
              );
              const sellerVerificationKeyHash =
                paymentRequest.SellerWallet.walletVkey;
              const submitResultTime = paymentRequest.submitResultTime;
              const unlockTime = paymentRequest.unlockTime;
              const externalDisputeUnlockTime =
                paymentRequest.externalDisputeUnlockTime;

              const datum = getDatum({
                buyerVerificationKeyHash,
                sellerVerificationKeyHash,
                blockchainIdentifier: paymentRequest.blockchainIdentifier,
                inputHash: paymentRequest.inputHash,
                resultHash: '',
                resultTime: Number(submitResultTime),
                unlockTime: Number(unlockTime),
                externalDisputeUnlockTime: Number(externalDisputeUnlockTime),
                newCooldownTimeSeller: 0,
                newCooldownTimeBuyer: 0,
                state: SmartContractState.FundsLocked,
              });

              unsignedTx.sendAssets(
                {
                  address: walletPairing.scriptAddress,
                  datum,
                },
                paymentRequest.PaidFunds.map((amount) => ({
                  unit: amount.unit == '' ? 'lovelace' : amount.unit,
                  quantity: amount.amount.toString(),
                })),
              );
            }

            const purchaseRequests = await Promise.allSettled(
              batchedRequests.map(async (request) => {
                await prisma.purchaseRequest.update({
                  where: { id: request.id },
                  data: {
                    NextAction: {
                      update: {
                        requestedAction: PurchasingAction.FundsLockingInitiated,
                      },
                    },
                    SmartContractWallet: {
                      connect: {
                        id: walletId,
                      },
                    },
                  },
                });
              }),
            );
            const failedPurchaseRequests = purchaseRequests.filter(
              (x) => x.status != 'fulfilled',
            );
            if (failedPurchaseRequests.length > 0) {
              logger.error(
                'Error updating payment status, before submitting tx ',
                failedPurchaseRequests,
              );
              throw new Error(
                'Error updating payment status, before submitting tx ',
              );
            }
            unsignedTx.setNetwork(convertNetwork(paymentContract.network));
            unsignedTx.setCollateral([collateralUtxo]);

            const completeTx = await unsignedTx.build();
            const signedTx = await wallet.signTx(completeTx);
            //submit the transaction to the blockchain

            const txHash = await wallet.submitTx(signedTx);
            //update purchase requests
            const purchaseRequestsUpdated = await Promise.allSettled(
              batchedRequests.map(async (request) => {
                await prisma.purchaseRequest.update({
                  where: { id: request.id },
                  data: {
                    CurrentTransaction: {
                      create: {
                        txHash: txHash,
                        status: TransactionStatus.Pending,
                        BlocksWallet: {
                          connect: {
                            id: walletId,
                          },
                        },
                      },
                    },
                    TransactionHistory: request.CurrentTransaction
                      ? {
                          connect: {
                            id: request.CurrentTransaction.id,
                          },
                        }
                      : undefined,
                  },
                });
              }),
            );
            const failedPurchaseRequestsUpdated =
              purchaseRequestsUpdated.filter((x) => x.status != 'fulfilled');
            if (failedPurchaseRequestsUpdated.length > 0) {
              throw new Error(
                'Error updating payment status ' +
                  failedPurchaseRequestsUpdated
                    .map((x) => convertErrorString(x.reason))
                    .join(', '),
              );
            } else {
              logger.debug('Batching payments successful', { txHash: txHash });
            }
            return true;
          }),
        );
        let index = 0;
        for (const result of results) {
          const request = walletPairings[index];

          if (result.status == 'rejected' || result.value != true) {
            const error =
              result.status == 'rejected'
                ? convertErrorString(result.reason)
                : 'Transaction did not return true';
            logger.error(
              `Error batching payments for wallet ${request.walletId}`,
              {
                error: error,
              },
            );
            for (const batchedRequest of request.batchedRequests) {
              await prisma.purchaseRequest.update({
                where: { id: batchedRequest.id },
                data: {
                  NextAction: {
                    update: {
                      requestedAction: PurchasingAction.WaitingForManualAction,
                      errorType: PurchaseErrorType.Unknown,
                      errorNote: 'Batching payments failed: ' + error,
                    },
                  },
                },
              });
            }
            await prisma.hotWallet.update({
              where: { id: request.walletId, deletedAt: null },
              data: {
                lockedAt: null,
                PendingTransaction: { disconnect: true },
              },
            });
            index++;
          }
        }
      }),
    );
  } catch (error) {
    logger.error('Error batching payments', error);
  } finally {
    release();
  }
}
