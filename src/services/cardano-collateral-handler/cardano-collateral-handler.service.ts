import {
  TransactionStatus,
  CollateralRequest,
  HotWallet,
  WalletSecret,
  CollateralRequestState,
} from '@prisma/client';
import { prisma } from '@/utils/db';
import { BlockfrostProvider, Transaction } from '@meshsdk/core';
import { logger } from '@/utils/logger';
import { convertNetwork } from '@/utils/converter/network-convert';
import { generateWalletExtended } from '@/utils/generator/wallet-generator';
import { advancedRetryAll, delayErrorResolver } from 'advanced-retry';
import { Mutex, MutexInterface, tryAcquire } from 'async-mutex';
import { convertErrorString } from '@/utils/converter/error-string-convert';
import { lockAndQueryCollateralRequests } from '@/utils/db/lock-and-query-collateral-request copy';

const mutex = new Mutex();

export async function fixCollateral() {
  let release: MutexInterface.Releaser | null;
  try {
    release = await tryAcquire(mutex).acquire();
  } catch (e) {
    logger.info('Mutex timeout when locking', { error: e });
    return;
  }

  try {
    //Submit a result for invalid tokens
    const paymentSourcesWithWalletLocked =
      await lockAndQueryCollateralRequests();

    await Promise.allSettled(
      paymentSourcesWithWalletLocked.map(async (paymentSource) => {
        if (paymentSource.CollateralRequest.length == 0) return;

        logger.info(
          `Registering ${paymentSource.CollateralRequest.length} agents for payment source ${paymentSource.id}`,
        );

        const network = convertNetwork(paymentSource.network);

        const collateralRequests: Array<
          CollateralRequest & {
            HotWallet: HotWallet & { Secret: WalletSecret };
          }
        > = paymentSource.CollateralRequest;

        if (collateralRequests.length == 0) return;

        const blockchainProvider = new BlockfrostProvider(
          paymentSource.PaymentSourceConfig.rpcProviderApiKey,
        );

        const results = await advancedRetryAll({
          errorResolvers: [
            delayErrorResolver({
              configuration: {
                maxRetries: 5,
                backoffMultiplier: 5,
                initialDelayMs: 500,
                maxDelayMs: 7500,
              },
            }),
          ],
          operations: collateralRequests.map((request) => async () => {
            const { wallet, utxos, address } = await generateWalletExtended(
              paymentSource.network,
              paymentSource.PaymentSourceConfig.rpcProviderApiKey,
              request.HotWallet.Secret.encryptedMnemonic,
            );

            if (utxos.length === 0) {
              throw new Error('No UTXOs found for the wallet');
            }

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
            if (collateralUtxo) {
              throw new Error('Collateral UTXO exists');
            }

            const filteredUtxos = utxos.sort((a, b) => {
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
              //sort by biggest lovelace
              return bLovelace - aLovelace;
            });

            const limitedFilteredUtxos = filteredUtxos.slice(
              0,
              Math.min(4, filteredUtxos.length),
            );

            const tx = new Transaction({
              initiator: wallet,
              fetcher: blockchainProvider,
            })
              .setMetadata(674, {
                msg: ['Masumi', 'Collateral'],
              })
              .setTxInputs(limitedFilteredUtxos);

            tx.isCollateralNeeded = false;

            tx.sendLovelace(address, '5000000');
            //sign the transaction with our address
            tx.setChangeAddress(address).setRequiredSigners([address]);
            tx.setNetwork(network);

            //build the transaction
            const unsignedTx = await tx.build();
            const signedTx = await wallet.signTx(unsignedTx, true);

            await prisma.collateralRequest.update({
              where: { id: request.id },
              data: {
                state: CollateralRequestState.Pending,
                Transaction: {
                  create: {
                    txHash: '',
                    status: TransactionStatus.Pending,
                    BlocksWallet: {
                      connect: {
                        id: request.HotWallet.id,
                      },
                    },
                  },
                },
              },
            });
            //submit the transaction to the blockchain
            const newTxHash = await wallet.submitTx(signedTx);
            await prisma.collateralRequest.update({
              where: { id: request.id },
              data: {
                state: CollateralRequestState.Confirmed,
                Transaction: {
                  update: {
                    txHash: newTxHash,
                    status: TransactionStatus.Pending,
                  },
                },
              },
            });

            logger.debug(`Created collateral transaction:
                  Tx ID: ${newTxHash}
                  View (after a bit) on https://${
                    network === 'preprod' ? 'preprod.' : ''
                  }cardanoscan.io/transaction/${newTxHash}
              `);
            return true;
          }),
        });
        let index = 0;
        for (const result of results) {
          const request = collateralRequests[index];
          if (result.success == false || result.result != true) {
            const error = result.error;
            logger.error(`Error registering collateral ${request.id}`, {
              error: error,
            });
            await prisma.collateralRequest.update({
              where: { id: request.id },
              data: {
                state: CollateralRequestState.Failed,
                error: convertErrorString(error),
                HotWallet: {
                  update: {
                    lockedAt: null,
                  },
                },
              },
            });
          }
          index++;
        }
      }),
    );
  } catch (error) {
    logger.error('Error submitting result', { error: error });
  } finally {
    release();
  }
}
