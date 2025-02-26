import { TransactionStatus, RegistrationState } from '@prisma/client';
import { Sema } from 'async-sema';
import { prisma } from '@/utils/db';
import { BlockfrostProvider, Transaction } from '@meshsdk/core';
import { logger } from '@/utils/logger';
import { convertNetwork } from '@/utils/converter/network-convert';
import { generateWalletExtended } from '@/utils/generator/wallet-generator';
import { lockAndQueryRegistryRequests } from '@/utils/db/lock-and-query-registry-request';
import { getRegistryScriptFromNetworkHandlerV1 } from '@/utils/generator/contract-generator';
import { advancedRetryAll, delayErrorResolver } from 'advanced-retry';

const updateMutex = new Sema(1);

export async function deRegisterAgentV1() {
  const acquiredMutex = await updateMutex.tryAcquire();
  //if we are already performing an update, we wait for it to finish and return
  if (!acquiredMutex) return await updateMutex.acquire();

  try {
    //Submit a result for invalid tokens
    const paymentSourcesWithWalletLocked = await lockAndQueryRegistryRequests({
      state: RegistrationState.DeregistrationRequested,
    });

    await Promise.allSettled(
      paymentSourcesWithWalletLocked.map(async (paymentSource) => {
        if (paymentSource.RegistryRequest.length == 0) return;

        logger.info(
          `Deregistering ${paymentSource.RegistryRequest.length} agents for payment source ${paymentSource.id}`,
        );
        const network = convertNetwork(paymentSource.network);

        const registryRequests = paymentSource.RegistryRequest;

        if (registryRequests.length == 0) return;

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
          operations: registryRequests.map((request) => async () => {
            if (!request.agentIdentifier) {
              throw new Error('Agent identifier is not set');
            }
            const { wallet, utxos, address } = await generateWalletExtended(
              paymentSource.network,
              paymentSource.PaymentSourceConfig.rpcProviderApiKey,
              request.SmartContractWallet.Secret.encryptedMnemonic,
            );

            if (utxos.length === 0) {
              throw new Error('No UTXOs found for the wallet');
            }
            const { script, policyId } =
              await getRegistryScriptFromNetworkHandlerV1(paymentSource);

            const redeemer = {
              data: { alternative: 1, fields: [] },
            };

            const tx = new Transaction({
              initiator: wallet,
              fetcher: blockchainProvider,
            })
              .setMetadata(674, {
                msg: ['Masumi', 'DeregisterAgent'],
              })
              .setTxInputs(utxos);

            tx.isCollateralNeeded = true;

            //setup minting data separately as the minting function does not work well with hex encoded strings without some magic
            tx.txBuilder
              .mintPlutusScript(script.version)
              .mint(
                '-1',
                policyId,
                request.agentIdentifier.slice(policyId.length),
              )
              .mintingScript(script.code)
              .mintRedeemerValue(redeemer.data, 'Mesh');
            tx.sendLovelace(address, '5000000');
            //sign the transaction with our address
            tx.setChangeAddress(address).setRequiredSigners([address]);
            tx.setNetwork(network);

            //build the transaction
            const unsignedTx = await tx.build();
            const signedTx = await wallet.signTx(unsignedTx, true);

            await prisma.registryRequest.update({
              where: { id: request.id },
              data: {
                state: RegistrationState.DeregistrationInitiated,
              },
            });
            //submit the transaction to the blockchain
            const newTxHash = await wallet.submitTx(signedTx);
            await prisma.registryRequest.update({
              where: { id: request.id },
              data: {
                CurrentTransaction: {
                  create: {
                    txHash: newTxHash,
                    status: TransactionStatus.Pending,
                    BlocksWallet: {
                      connect: {
                        id: request.SmartContractWallet!.id,
                      },
                    },
                  },
                },
              },
            });

            logger.debug(`Created withdrawal transaction:
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
          const request = registryRequests[index];
          if (result.success == false || result.result != true) {
            const error = result.error;
            logger.error(`Error deregistering agent ${request.id}`, {
              error: error,
            });
            await prisma.registryRequest.update({
              where: { id: request.id },
              data: {
                state: RegistrationState.DeregistrationFailed,
                SmartContractWallet: {
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
    //library is strange as we can release from any non-acquired semaphore
    updateMutex.release();
  }
}

export const cardanoDeregisterHandlerService = { deRegisterAgentV1 };
