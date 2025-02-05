import 'dotenv/config';
import express from 'express';
import dotenv from 'dotenv';
import { createLogger, format, transports } from 'winston';
import cron from 'node-cron';
import { PrismaClient, $Enums, Prisma, Permission, ApiKeyStatus, Network } from '@prisma/client';
import { Sema } from 'async-sema';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { mBool, BlockfrostProvider, MeshWallet, Transaction as Transaction$1, resolvePaymentKeyHash, applyParamsToScript, unixTimeToEnclosingSlot, SLOT_CONFIG_NETWORK } from '@meshsdk/core';
import { Transaction, PlutusDatumSchema } from '@emurgo/cardano-serialization-lib-nodejs';
import { Data } from 'lucid-cardano';
import { scryptSync, createDecipheriv, randomBytes, createCipheriv } from 'crypto';
import * as cbor from 'cbor';
import { resolvePaymentKeyHash as resolvePaymentKeyHash$1, resolveStakeKeyHash, resolvePlutusScriptAddress, deserializePlutusScript } from '@meshsdk/core-cst';
import { defaultEndpointsFactory, Middleware, ez, DependsOnMethod, createConfig, createServer } from 'express-zod-api';
import { z } from 'zod';
import createHttpError from 'http-errors';
import cuid2, { createId } from '@paralleldrive/cuid2';
import { blake2b } from 'ethereum-cryptography/blake2b.js';
import ui from 'swagger-ui-express';
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import path from 'path';

dotenv.config();
if (process.env.DATABASE_URL == null)
  throw new Error("Undefined DATABASE_URL ENV variable");
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length <= 20)
  throw new Error("Undefined or unsecure ENCRYPTION_KEY ENV variable. Require min 20 char");
const CONFIG = {
  PORT: process.env.PORT ?? "3001",
  DATABASE_URL: process.env.DATABASE_URL,
  BATCH_PAYMENT_INTERVAL: process.env.BATCH_PAYMENT_INTERVAL ?? "*/4 * * * *",
  CHECK_TX_INTERVAL: process.env.CHECK_TX_INTERVAL ?? "*/3 * * * *",
  CHECK_COLLECTION_INTERVAL: process.env.CHECK_COLLECTION_INTERVAL ?? "*/5 * * * *",
  CHECK_COLLECT_REFUND_INTERVAL: process.env.CHECK_COLLECT_REFUND_INTERVAL ?? "*/5 * * * *",
  CHECK_REFUND_INTERVAL: process.env.CHECK_REFUND_INTERVAL ?? "*/5 * * * *",
  CHECK_DENY_INTERVAL: process.env.CHECK_DENY_INTERVAL ?? "*/5 * * * *",
  CHECK_WALLET_TRANSACTION_HASH_INTERVAL: process.env.CHECK_WALLET_TRANSACTION_HASH_INTERVAL ?? "*/1 * * * *",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY
};
const DEFAULTS = {
  ADMIN_WALLET1_PREPROD: "addr_test1qr7pdg0u7vy6a5p7cx9my9m0t63f4n48pwmez30t4laguawge7xugp6m5qgr6nnp6wazurtagjva8l9fc3a5a4scx0rq2ymhl3",
  ADMIN_WALLET2_PREPROD: "addr_test1qplhs9snd92fmr3tzw87uujvn7nqd4ss0fn8yz7mf3y2mf3a3806uqngr7hvksqvtkmetcjcluu6xeguagwyaxevdhmsuycl5a",
  ADMIN_WALLET3_PREPROD: "addr_test1qzy7a702snswullyjg06j04jsulldc6yw0m4r4w49jm44f30pgqg0ez34lrdj7dy7ndp2lgv8e35e6jzazun8gekdlsq99mm6w",
  FEE_WALLET_PREPROD: "addr_test1qqfuahzn3rpnlah2ctcdjxdfl4230ygdar00qxc32guetexyg7nun6hggw9g2gpnayzf22sksr0aqdgkdcvqpc2stwtqt4u496",
  FEE_PERMILLE_PREPROD: 50,
  //equals simulated 5% fee for the network
  PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD: "addr_test1wqarcz6uad8l44dkmmtllud2amwc9t0xa6l5mv2t7tq4szgagm7r2",
  REGISTRY_POLICY_ID_PREPROD: "398a61a6bc4d51cc90b2a5710dbc2818013fc41ad428c2e4ba09b006",
  ADMIN_WALLET1_MAINNET: "addr1q87pdg0u7vy6a5p7cx9my9m0t63f4n48pwmez30t4laguawge7xugp6m5qgr6nnp6wazurtagjva8l9fc3a5a4scx0rqfjxhnw",
  ADMIN_WALLET2_MAINNET: "addr1q9lhs9snd92fmr3tzw87uujvn7nqd4ss0fn8yz7mf3y2mf3a3806uqngr7hvksqvtkmetcjcluu6xeguagwyaxevdhmslj9lcz",
  ADMIN_WALLET3_MAINNET: "addr1qxy7a702snswullyjg06j04jsulldc6yw0m4r4w49jm44f30pgqg0ez34lrdj7dy7ndp2lgv8e35e6jzazun8gekdlsqxnxmk3",
  FEE_WALLET_MAINNET: "addr1qyfuahzn3rpnlah2ctcdjxdfl4230ygdar00qxc32guetexyg7nun6hggw9g2gpnayzf22sksr0aqdgkdcvqpc2stwtqgrp4f9",
  FEE_PERMILLE_MAINNET: 50,
  //equals 5% fee for the network
  PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET: "addr1wyarcz6uad8l44dkmmtllud2amwc9t0xa6l5mv2t7tq4szgxq0zv0",
  REGISTRY_POLICY_ID_MAINNET: "fbd41ebabfed0fd1565f024b11d278dbf03b471a17a5578c79b50edb"
};

const { combine: combine$1, timestamp: timestamp$1, printf, errors: errors$1 } = format;
function buildDevLogger() {
  const logFormat = printf(({ level, message, timestamp: timestamp2, stack }) => {
    return `${timestamp2} ${level}: ${stack || message}`;
  });
  return createLogger({
    format: combine$1(
      format.colorize(),
      timestamp$1({ format: "YYYY-MM-DD HH:mm:ss" }),
      errors$1({ stack: true }),
      logFormat
    ),
    transports: [new transports.Console()]
  });
}

const { combine, timestamp, errors, json } = format;
function buildProdLogger() {
  return createLogger({
    format: combine(timestamp(), errors({ stack: true }), json()),
    defaultMeta: { service: "payment-service" },
    transports: [new transports.Console()]
  });
}

let logger;
if (process.env.NODE_ENV === "dev") {
  logger = buildDevLogger();
} else {
  logger = buildProdLogger();
}

const prisma = new PrismaClient({
  //log: ["query", "info", "warn", "error"]
});
async function cleanupDB() {
  await prisma.$disconnect();
}
async function initDB() {
  await prisma.$connect();
}

const updateMutex$6 = new Sema(1);
async function checkLatestTransactions() {
  const acquiredMutex = await updateMutex$6.tryAcquire();
  if (!acquiredMutex)
    return await updateMutex$6.acquire();
  try {
    const networkChecks = await prisma.$transaction(async (prisma2) => {
      const networkChecks2 = await prisma2.networkHandler.findMany({
        where: {
          paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
          OR: [
            { isSyncing: false },
            {
              isSyncing: true,
              updatedAt: {
                lte: new Date(
                  Date.now() - //3 minutes
                  1e3 * 60 * 3
                )
              }
            }
          ]
          //isSyncing: false
        },
        include: {
          SellingWallets: true,
          CollectionWallet: true
        }
      });
      if (networkChecks2.length == 0) {
        logger.warn("No available network handlers found, skipping update. It could be that an other instance is already updating");
        return null;
      }
      await prisma2.networkHandler.updateMany({
        where: { id: { in: networkChecks2.map((x) => x.id) } },
        data: { isSyncing: true }
      });
      return networkChecks2.map((x) => {
        return { ...x, isSyncing: true };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 1e4, maxWait: 1e4 });
    if (networkChecks == null)
      return;
    try {
      const results = await Promise.allSettled(networkChecks.map(async (networkCheck) => {
        let latestPage = networkCheck.lastPageChecked;
        let latestIdentifier = networkCheck.lastIdentifierChecked;
        const blockfrost = new BlockFrostAPI({
          projectId: networkCheck.rpcProviderApiKey,
          network: networkCheck.network == $Enums.Network.MAINNET ? "mainnet" : "preprod"
        });
        let latestTx = await blockfrost.addressesTransactions(networkCheck.paymentContractAddress, { count: 25, page: networkCheck.lastPageChecked });
        while (latestTx.length > 0) {
          const foundTxIndex = latestTx.findIndex((tx) => tx.tx_hash == latestIdentifier);
          if (foundTxIndex == latestTx.length - 1)
            break;
          if (foundTxIndex != -1)
            latestTx = latestTx.slice(foundTxIndex);
          const txData = await Promise.all(latestTx.map(async (tx) => {
            try {
              const cbor = await blockfrost.txsCbor(tx.tx_hash);
              const utxos = await blockfrost.txsUtxos(tx.tx_hash);
              const transaction = Transaction.from_bytes(Buffer.from(cbor.cbor, "hex"));
              return { tx, utxos, transaction };
            } catch (error) {
              logger.warn("Error getting tx metadata, ignoring tx", { error, tx: tx.tx_hash });
              return { tx, utxos: null, transaction: null };
            }
          }));
          const filteredTxData = txData.filter((x) => x.utxos != null && x.transaction != null);
          for (const tx of filteredTxData) {
            const utxos = tx.utxos;
            const inputs = utxos.inputs;
            const outputs = utxos.outputs;
            const valueInputs = inputs.filter((x) => {
              return x.address == networkCheck.paymentContractAddress;
            });
            const valueOutputs = outputs.filter((x) => {
              return x.address == networkCheck.paymentContractAddress;
            });
            const redeemers = tx.transaction.witness_set().redeemers();
            if (redeemers == null) {
              if (valueInputs.length != 0) {
                continue;
              }
              for (const output of valueOutputs) {
                const outputDatum = output.inline_datum;
                if (outputDatum == null) {
                  continue;
                }
                const decodedOutputDatum = Data.from(outputDatum);
                const decodedNewContract = decodeV1ContractDatum(decodedOutputDatum);
                if (decodedNewContract == null) {
                  continue;
                }
                await prisma.$transaction(async (prisma2) => {
                  const databaseEntry = await prisma2.purchaseRequest.findMany({
                    where: {
                      identifier: decodedNewContract.referenceId,
                      networkHandlerId: networkCheck.id,
                      status: $Enums.PurchasingRequestStatus.PurchaseInitiated
                    }
                  });
                  if (databaseEntry.length == 0) {
                    return;
                  }
                  if (databaseEntry.length > 1) {
                    for (const entry of databaseEntry) {
                      await prisma2.purchaseRequest.update({
                        where: { id: entry.id },
                        data: { errorRequiresManualReview: true, errorNote: "Duplicate purchase transaction", errorType: $Enums.PaymentRequestErrorType.UNKNOWN }
                      });
                    }
                    return;
                  }
                  await prisma2.purchaseRequest.update({
                    where: { id: databaseEntry[0].id },
                    data: { status: $Enums.PurchasingRequestStatus.PurchaseConfirmed, txHash: tx.tx.tx_hash, utxo: tx.utxos.hash, potentialTxHash: null }
                  });
                }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 1e4, maxWait: 1e4 });
                await prisma.$transaction(
                  async (prisma2) => {
                    const databaseEntry = await prisma2.paymentRequest.findMany({
                      where: {
                        identifier: decodedNewContract.referenceId,
                        networkHandlerId: networkCheck.id,
                        status: $Enums.PaymentRequestStatus.PaymentRequested
                      },
                      include: {
                        Amounts: true
                      }
                    });
                    if (databaseEntry.length == 0) {
                      return;
                    }
                    if (databaseEntry.length > 1) {
                      for (const entry of databaseEntry) {
                        await prisma2.paymentRequest.update({
                          where: { id: entry.id },
                          data: {
                            errorRequiresManualReview: true,
                            errorNote: "Duplicate payment transaction",
                            errorType: $Enums.PaymentRequestErrorType.UNKNOWN
                          }
                        });
                      }
                      return;
                    }
                    const valueMatches = databaseEntry[0].Amounts.every((x) => {
                      const existingAmount = output.amount.find((y) => y.unit == x.unit);
                      if (existingAmount == null)
                        return false;
                      return x.amount.toString() == existingAmount.quantity;
                    });
                    let newStatus = $Enums.PaymentRequestStatus.PaymentInvalid;
                    if (valueMatches == true) {
                      newStatus = $Enums.PaymentRequestStatus.PaymentConfirmed;
                    }
                    await prisma2.paymentRequest.update({
                      where: { id: databaseEntry[0].id },
                      data: {
                        status: newStatus,
                        txHash: tx.tx.tx_hash,
                        utxo: tx.utxos.hash,
                        potentialTxHash: null,
                        BuyerWallet: {
                          connectOrCreate: {
                            where: { networkHandlerId_walletVkey: { networkHandlerId: networkCheck.id, walletVkey: decodedNewContract.buyer } },
                            create: { walletVkey: decodedNewContract.buyer, NetworkHandler: { connect: { id: networkCheck.id } } }
                          }
                        }
                      }
                    });
                  },
                  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 1e5, maxWait: 1e4 }
                );
              }
              await prisma.networkHandler.update({
                where: { id: networkCheck.id },
                data: { lastIdentifierChecked: tx.tx.tx_hash, lastPageChecked: latestPage }
              });
              latestIdentifier = tx.tx.tx_hash;
            } else {
              if (redeemers.len() != 1) {
                continue;
              }
              if (valueInputs.length != 1) {
                continue;
              }
              const inputDatum = valueInputs[0].inline_datum;
              if (inputDatum == null) {
                continue;
              }
              const decodedInputDatum = Data.from(inputDatum);
              const decodedOldContract = decodeV1ContractDatum(decodedInputDatum);
              if (decodedOldContract == null) {
                continue;
              }
              if (valueOutputs.length > 1) {
                continue;
              }
              const outputDatum = valueOutputs.length == 1 ? valueOutputs[0].inline_datum : null;
              const decodedOutputDatum = outputDatum != null ? Data.from(outputDatum) : null;
              const decodedNewContract = decodeV1ContractDatum(decodedOutputDatum);
              const redeemer = redeemers.get(0);
              const redeemerVersion = JSON.parse(redeemer.data().to_json(PlutusDatumSchema.BasicConversions))["constructor"];
              if (redeemerVersion != 0 && redeemerVersion != 3 && decodedNewContract == null) {
                logger.error("Possible invalid state in smart contract detected. tx_hash: " + tx.tx.tx_hash);
                continue;
              }
              let newStatus;
              let newPurchasingStatus;
              if (redeemerVersion == 0) {
                newStatus = $Enums.PaymentRequestStatus.WithdrawnConfirmed;
                newPurchasingStatus = $Enums.PurchasingRequestStatus.Withdrawn;
              } else if (redeemerVersion == 1) {
                newStatus = $Enums.PaymentRequestStatus.RefundRequested;
                newPurchasingStatus = $Enums.PurchasingRequestStatus.RefundRequestConfirmed;
              } else if (redeemerVersion == 2) {
                if (decodedNewContract?.resultHash) {
                  newStatus = $Enums.PaymentRequestStatus.CompletedConfirmed;
                  newPurchasingStatus = $Enums.PurchasingRequestStatus.Completed;
                } else {
                  newStatus = await prisma.$transaction(
                    async (prisma2) => {
                      const databaseEntry = await prisma2.paymentRequest.findMany({
                        where: {
                          identifier: decodedNewContract.referenceId,
                          networkHandlerId: networkCheck.id,
                          status: $Enums.PaymentRequestStatus.PaymentRequested
                        },
                        include: {
                          Amounts: true
                        }
                      });
                      if (databaseEntry.length == 0) {
                        return $Enums.PaymentRequestStatus.PaymentInvalid;
                      }
                      if (databaseEntry.length > 1) {
                        for (const entry of databaseEntry) {
                          await prisma2.paymentRequest.update({
                            where: { id: entry.id },
                            data: {
                              errorRequiresManualReview: true,
                              errorNote: "Duplicate payment transaction",
                              errorType: $Enums.PaymentRequestErrorType.UNKNOWN
                            }
                          });
                        }
                        return $Enums.PaymentRequestStatus.PaymentInvalid;
                      }
                      const valueMatches = databaseEntry[0].Amounts.every((x) => {
                        const existingAmount = valueOutputs[0].amount.find((y) => y.unit == x.unit);
                        if (existingAmount == null)
                          return false;
                        return x.amount.toString() == existingAmount.quantity;
                      });
                      let newStatus2 = $Enums.PaymentRequestStatus.PaymentInvalid;
                      if (valueMatches == true) {
                        newStatus2 = $Enums.PaymentRequestStatus.PaymentConfirmed;
                      }
                      await prisma2.paymentRequest.update({
                        where: { id: databaseEntry[0].id },
                        data: {
                          status: newStatus2,
                          txHash: tx.tx.tx_hash,
                          utxo: tx.utxos.hash,
                          potentialTxHash: null,
                          BuyerWallet: {
                            connectOrCreate: {
                              where: { networkHandlerId_walletVkey: { networkHandlerId: networkCheck.id, walletVkey: decodedNewContract.buyer } },
                              create: { walletVkey: decodedNewContract.buyer, NetworkHandler: { connect: { id: networkCheck.id } } }
                            }
                          }
                        }
                      });
                      return newStatus2;
                    },
                    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 1e5, maxWait: 1e4 }
                  );
                  newPurchasingStatus = $Enums.PurchasingRequestStatus.PurchaseConfirmed;
                }
              } else if (redeemerVersion == 3) {
                newStatus = $Enums.PaymentRequestStatus.Refunded;
                newPurchasingStatus = $Enums.PurchasingRequestStatus.RefundConfirmed;
              } else if (redeemerVersion == 4) {
                newStatus = $Enums.PaymentRequestStatus.DisputedWithdrawn;
                newPurchasingStatus = $Enums.PurchasingRequestStatus.DisputedWithdrawn;
              } else if (redeemerVersion == 5) {
                newStatus = $Enums.PaymentRequestStatus.CompletedConfirmed;
                newPurchasingStatus = $Enums.PurchasingRequestStatus.Completed;
              } else if (redeemerVersion == 6) {
                newStatus = $Enums.PaymentRequestStatus.RefundRequested;
                await prisma.$transaction(async (prisma2) => {
                  const paymentRequest = await prisma2.paymentRequest.findUnique({
                    where: { networkHandlerId_identifier: { networkHandlerId: networkCheck.id, identifier: decodedOldContract.referenceId } }
                  });
                  if (paymentRequest == null) {
                    return;
                  }
                  await prisma2.paymentRequest.update({
                    where: { id: paymentRequest.id },
                    data: { status: newStatus, resultHash: null, txHash: tx.tx.tx_hash, utxo: tx.utxos.hash, potentialTxHash: null }
                  });
                }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 1e4, maxWait: 1e4 });
                newPurchasingStatus = $Enums.PurchasingRequestStatus.RefundRequestConfirmed;
              } else {
                continue;
              }
              await Promise.allSettled([
                handlePaymentTransactionCardanoV1(tx.tx.tx_hash, tx.utxos.hash, newStatus, networkCheck.id, decodedOldContract.seller, decodedOldContract.referenceId),
                handlePurchasingTransactionCardanoV1(tx.tx.tx_hash, tx.utxos.hash, newPurchasingStatus, networkCheck.id, decodedOldContract.seller, decodedOldContract.referenceId)
              ]);
            }
            await prisma.networkHandler.update({
              where: { id: networkCheck.id },
              data: { lastIdentifierChecked: tx.tx.tx_hash, lastPageChecked: latestPage }
            });
            latestIdentifier = tx.tx.tx_hash;
          }
          await prisma.networkHandler.update({
            where: { id: networkCheck.id },
            data: { lastIdentifierChecked: latestTx[latestTx.length - 1].tx_hash, lastPageChecked: latestPage }
          });
          if (latestTx.length >= 25) {
            latestPage++;
            latestTx = await blockfrost.addressesTransactions(networkCheck.paymentContractAddress, { count: 25, page: latestPage });
          } else {
            latestTx = [];
          }
        }
      }));
      const failedResults = results.filter((x) => x.status == "rejected");
      if (failedResults.length > 0) {
        logger.error("Error updating tx data", { error: failedResults, networkChecks });
      }
    } finally {
      try {
        await prisma.networkHandler.updateMany({
          where: { id: { in: networkChecks.map((x) => x.id) } },
          data: { isSyncing: false }
        });
      } catch (error) {
        logger.error("Error updating network checks syncing status", { error, networkChecks });
      }
    }
  } finally {
    updateMutex$6.release();
  }
}
async function handlePaymentTransactionCardanoV1(tx_hash, utxo_hash, newStatus, networkCheckId, sellerVkey, referenceId) {
  await prisma.$transaction(async (prisma2) => {
    const paymentRequest = await prisma2.paymentRequest.findUnique({
      where: { networkHandlerId_identifier: { networkHandlerId: networkCheckId, identifier: referenceId } }
    });
    if (paymentRequest == null) {
      return;
    }
    await prisma2.paymentRequest.update({
      where: { id: paymentRequest.id },
      data: { status: newStatus, txHash: tx_hash, utxo: utxo_hash, potentialTxHash: null }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 1e4, maxWait: 1e4 });
}
async function handlePurchasingTransactionCardanoV1(tx_hash, utxo_hash, newStatus, networkCheckId, sellerVkey, referenceId) {
  await prisma.$transaction(async (prisma2) => {
    const purchasingRequest = await prisma2.paymentRequest.findUnique({
      where: { networkHandlerId_identifier: { networkHandlerId: networkCheckId, identifier: referenceId } }
    });
    if (purchasingRequest == null) {
      return;
    }
    await prisma2.purchaseRequest.update({
      where: { id: purchasingRequest.id },
      data: { status: newStatus, txHash: tx_hash, utxo: utxo_hash, potentialTxHash: null }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 1e4, maxWait: 1e4 });
}
function decodeV1ContractDatum(decodedDatum) {
  if (decodedDatum == null) {
    return null;
  }
  if (decodedDatum.fields?.length != 9) {
    return null;
  }
  if (typeof decodedDatum.fields[0] !== "string") {
    return null;
  }
  const buyer = decodedDatum.fields[0];
  if (typeof decodedDatum.fields[1] !== "string") {
    return null;
  }
  const seller = decodedDatum.fields[1];
  if (typeof decodedDatum.fields[2] !== "string") {
    return null;
  }
  const referenceId = Buffer.from(decodedDatum.fields[2], "hex").toString("utf-8");
  if (typeof decodedDatum.fields[3] !== "string") {
    return null;
  }
  const resultHash = Buffer.from(decodedDatum.fields[3], "hex").toString("utf-8");
  if (typeof decodedDatum.fields[4] !== "number" && typeof decodedDatum.fields[4] !== "bigint") {
    return null;
  }
  if (typeof decodedDatum.fields[5] !== "number" && typeof decodedDatum.fields[5] !== "bigint") {
    return null;
  }
  if (typeof decodedDatum.fields[6] !== "number" && typeof decodedDatum.fields[6] !== "bigint") {
    return null;
  }
  const resultTime = decodedDatum.fields[4];
  const unlockTime = decodedDatum.fields[5];
  const refundTime = decodedDatum.fields[6];
  const refundRequested = mBoolToBool(decodedDatum.fields[7]);
  const refundDenied = mBoolToBool(decodedDatum.fields[8]);
  if (refundRequested == null || refundDenied == null) {
    return null;
  }
  return { buyer, seller, referenceId, resultHash, resultTime, unlockTime, refundTime, refundRequested, refundDenied };
}
function mBoolToBool(value) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const bFalse = mBool(false);
  const bTrue = mBool(true);
  if (value.index == bTrue.alternative && typeof value.fields == typeof bTrue.fields) {
    return true;
  }
  if (value.index == bFalse.alternative && typeof value.fields == typeof bFalse.fields) {
    return false;
  }
  return null;
}
const cardanoTxHandlerService = { checkLatestTransactions, decodeV1ContractDatum, mBoolToBool };

function decrypt(secretEncrypted) {
  const secret = Buffer.from(secretEncrypted, "hex");
  const salt = secret.subarray(0, 16);
  const iv = secret.subarray(16, 32);
  const password = CONFIG.ENCRYPTION_KEY;
  const key = scryptSync(password, salt, 32);
  const encryptedData = secret.subarray(32);
  const decryptionCipher = createDecipheriv("aes-256-cbc", key, iv);
  return decryptionCipher.update(encryptedData, void 0, "utf8") + decryptionCipher.final("utf8");
}
function encrypt(secret) {
  const salt = randomBytes(16);
  const key = scryptSync(CONFIG.ENCRYPTION_KEY, salt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  return salt.toString("hex") + iv.toString("hex") + cipher.update(secret, "utf8", "hex") + cipher.final("hex");
}

function convertNetwork(network) {
  switch (network) {
    case "MAINNET":
      return "mainnet";
    case "PREPROD":
      return "preprod";
    default:
      throw new Error("Invalid network");
  }
}
function convertNetworkToId(network) {
  switch (network) {
    case "MAINNET":
      return 1;
    case "PREPROD":
      return 0;
    default:
      throw new Error("Invalid network");
  }
}

const updateMutex$5 = new Sema(1);
async function batchLatestPaymentEntriesV1() {
  const maxBatchSize = 10;
  const minTransactionCalculation = 300000n;
  const acquiredMutex = await updateMutex$5.tryAcquire();
  if (!acquiredMutex)
    return await updateMutex$5.acquire();
  try {
    const networkChecksWithWalletLocked = await prisma.$transaction(async (prisma2) => {
      const networkChecks = await prisma2.networkHandler.findMany({
        where: {
          paymentType: "WEB3_CARDANO_V1",
          PurchasingWallets: { some: { PendingTransaction: null } }
        },
        include: {
          PurchaseRequests: {
            where: { status: $Enums.PurchasingRequestStatus.PurchaseRequested, errorType: null },
            include: {
              Amounts: {
                select: {
                  amount: true,
                  unit: true
                }
              },
              SellerWallet: {
                select: {
                  walletVkey: true
                }
              }
            }
          },
          PurchasingWallets: { include: { WalletSecret: true } }
        }
      });
      const purchasingWalletIds = [];
      for (const networkCheck of networkChecks) {
        for (const purchasingWallet of networkCheck.PurchasingWallets) {
          if (purchasingWallet.id) {
            purchasingWalletIds.push(purchasingWallet.id);
          } else {
            logger.warn("No purchasing wallet found for purchase request", { purchasingWallet });
          }
        }
      }
      for (const purchasingWalletId of purchasingWalletIds) {
        await prisma2.purchasingWallet.update({
          where: { id: purchasingWalletId },
          data: { PendingTransaction: { create: { hash: null } } }
        });
      }
      return networkChecks;
    }, { isolationLevel: "Serializable" });
    await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {
      const network = convertNetwork(networkCheck.network);
      const networkId = convertNetworkToId(networkCheck.network);
      const blockchainHandler = new BlockfrostProvider(networkCheck.rpcProviderApiKey, 0);
      const paymentRequests = networkCheck.PurchaseRequests;
      if (paymentRequests.length == 0) {
        logger.info("no payment requests found for network " + networkCheck.network + " " + networkCheck.paymentContractAddress);
        return;
      }
      const potentialWallets = networkCheck.PurchasingWallets;
      const walletAmounts = await Promise.all(potentialWallets.map(async (wallet) => {
        const secretEncrypted = wallet.WalletSecret.secret;
        const secretDecrypted = decrypt(secretEncrypted);
        const meshWallet = new MeshWallet({
          networkId,
          fetcher: blockchainHandler,
          submitter: blockchainHandler,
          key: {
            type: "mnemonic",
            words: secretDecrypted.split(" ")
          }
        });
        const amounts = await meshWallet.getBalance();
        return {
          wallet: meshWallet,
          scriptAddress: networkCheck.paymentContractAddress,
          amounts: amounts.map((amount) => ({ unit: amount.unit, quantity: parseFloat(amount.quantity) }))
        };
      }));
      const paymentRequestsRemaining = [...paymentRequests];
      const walletPairings = [];
      let maxBatchSizeReached = false;
      for (const walletData of walletAmounts) {
        const wallet = walletData.wallet;
        const amounts = walletData.amounts;
        const batchedPaymentRequests = [];
        while (paymentRequestsRemaining.length > 0) {
          if (batchedPaymentRequests.length >= maxBatchSize) {
            maxBatchSizeReached = true;
            break;
          }
          const paymentRequest = paymentRequestsRemaining[0];
          const lovelaceRequired = paymentRequest.Amounts.findIndex((amount) => amount.unit.toLowerCase() == "lovelace");
          if (lovelaceRequired == -1) {
            paymentRequest.Amounts.push({ unit: "lovelace", amount: minTransactionCalculation });
          } else {
            const result = paymentRequest.Amounts.splice(lovelaceRequired, 1);
            paymentRequest.Amounts.push({ unit: "lovelace", amount: minTransactionCalculation + result[0].amount });
          }
          let isFulfilled = true;
          for (const paymentAmount of paymentRequest.Amounts) {
            const walletAmount = amounts.find((amount) => amount.unit == paymentAmount.unit);
            if (walletAmount == null || paymentAmount.amount > walletAmount.quantity) {
              isFulfilled = false;
              break;
            }
          }
          if (isFulfilled) {
            batchedPaymentRequests.push(paymentRequest);
            for (const paymentAmount of paymentRequest.Amounts) {
              const walletAmount = amounts.find((amount) => amount.unit == paymentAmount.unit);
              walletAmount.quantity -= parseInt(paymentAmount.amount.toString());
            }
            paymentRequestsRemaining.splice(0, 1);
          }
        }
        walletPairings.push({ wallet, scriptAddress: walletData.scriptAddress, batchedRequests: batchedPaymentRequests });
      }
      if (paymentRequestsRemaining.length > 0 && maxBatchSizeReached == false)
        await Promise.allSettled(paymentRequestsRemaining.map(async (paymentRequest) => {
          await prisma.purchaseRequest.update({
            where: { id: paymentRequest.id },
            data: {
              errorType: "INSUFFICIENT_FUNDS",
              errorRequiresManualReview: true,
              errorNote: "Not enough funds in wallets"
            }
          });
        }));
      await Promise.allSettled(walletPairings.map(async (walletPairing) => {
        try {
          const wallet = walletPairing.wallet;
          const batchedRequests = walletPairing.batchedRequests;
          const unsignedTx = await new Transaction$1({ initiator: wallet }).setMetadata(674, {
            msg: ["Masumi", "PaymentBatched"]
          });
          for (const paymentRequest of batchedRequests) {
            const buyerVerificationKeyHash = resolvePaymentKeyHash(wallet.getUsedAddress().toBech32());
            const sellerVerificationKeyHash = paymentRequest.SellerWallet.walletVkey;
            const submitResultTime = paymentRequest.submitResultTime;
            const unlockTime = paymentRequest.unlockTime;
            const refundTime = paymentRequest.refundTime;
            const correctedPaymentAmounts = paymentRequest.Amounts;
            const lovelaceIndex = correctedPaymentAmounts.findIndex((amount) => amount.unit.toLowerCase() == "lovelace");
            if (lovelaceIndex != -1) {
              const removedLovelace = correctedPaymentAmounts.splice(lovelaceIndex, 1);
              if (removedLovelace[0].amount > minTransactionCalculation) {
                correctedPaymentAmounts.push({ unit: "lovelace", amount: removedLovelace[0].amount - minTransactionCalculation });
              }
            }
            const datum = {
              value: {
                alternative: 0,
                fields: [
                  buyerVerificationKeyHash,
                  sellerVerificationKeyHash,
                  paymentRequest.identifier,
                  paymentRequest.resultHash ?? "",
                  submitResultTime,
                  unlockTime,
                  refundTime,
                  //is converted to false
                  mBool(false),
                  //is converted to false
                  mBool(false)
                ]
              },
              inline: true
            };
            unsignedTx.sendAssets(
              {
                address: walletPairing.scriptAddress,
                datum
              },
              paymentRequest.Amounts.map((amount) => ({ unit: amount.unit, quantity: amount.amount.toString() }))
            );
          }
          const completeTx = await unsignedTx.build();
          const signedTx = await wallet.signTx(completeTx);
          const txHash = await wallet.submitTx(signedTx);
          try {
            const purchaseRequests = await Promise.allSettled(batchedRequests.map(async (request) => {
              await prisma.purchaseRequest.update({ where: { id: request.id }, data: { SmartContractWallet: { update: { PendingTransaction: { update: { hash: txHash } } } }, potentialTxHash: txHash, status: $Enums.PurchasingRequestStatus.PurchaseInitiated } });
            }));
            const failedPurchaseRequests = purchaseRequests.filter((x) => x.status != "fulfilled");
            if (failedPurchaseRequests.length > 0) {
              logger.error("Error updating payment status, retrying ", failedPurchaseRequests);
            }
          } catch (error) {
            logger.error("Error updating payment status, retrying ", error);
            const failedRequests = await Promise.allSettled(batchedRequests.map(async (request) => {
              await prisma.purchaseRequest.update({ where: { id: request.id }, data: { potentialTxHash: txHash, status: $Enums.PurchasingRequestStatus.PurchaseInitiated, SmartContractWallet: { update: { PendingTransaction: { update: { hash: txHash } } } } } });
            }));
            const retriedFailedRequests = failedRequests.filter((x) => x.status != "fulfilled");
            if (retriedFailedRequests.length > 0) {
              logger.error("Error updating payment status while retrying ", error, retriedFailedRequests);
            }
          }
        } catch (error) {
          logger.error("Error batching payments", error);
        }
      }));
    }));
  } finally {
    updateMutex$5.release();
  }
}

var preamble$1 = {
	title: "nmkr/masumi-payment",
	description: "Aiken contracts for project 'nmkr/masumi-payment'",
	version: "0.0.0",
	plutusVersion: "v3",
	compiler: {
		name: "Aiken",
		version: "v1.1.7+e2fb28b"
	},
	license: "Apache-2.0"
};
var validators$1 = [
	{
		title: "vested_pay.vested_pay.spend",
		datum: {
			title: "datum",
			schema: {
				$ref: "#/definitions/vested_pay~1Datum"
			}
		},
		redeemer: {
			title: "redeemer",
			schema: {
				$ref: "#/definitions/vested_pay~1Action"
			}
		},
		parameters: [
			{
				title: "required_admins_multi_sig",
				schema: {
					$ref: "#/definitions/Int"
				}
			},
			{
				title: "admin_vks",
				schema: {
					$ref: "#/definitions/List$VerificationKeyHash"
				}
			},
			{
				title: "fee_address",
				schema: {
					$ref: "#/definitions/cardano~1address~1Address"
				}
			},
			{
				title: "fee_permille",
				schema: {
					$ref: "#/definitions/Int"
				}
			}
		],
		compiledCode: "590cd501010032323232323232232232223225333009323232323253323300f300130103754004264664464646464a66602c60060022a66603260306ea80280085854ccc058c02000454ccc064c060dd50050010b0a99980b18020008a99980c980c1baa00a00216153330163370e90030008a99980c980c1baa00a00216153330163370e90040008a99980c980c1baa00a00216153330163370e90050008a99980c980c1baa00a00216153330163370e90060008a99980c980c1baa00a0021616301637540122a6660286002602a6ea800c4c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c94ccc0a4c058c0a8dd50008991919192999816980f99918008009129998190008a4000266e012002330020023035001330013758600e605e6ea80888cdd7980418181baa30043030375400200626464646464646464646464646464646464a66607c60560042a66607c6600a0660422a66607c6600203203a264a66607e605860806ea800454ccc0fccc88cc034c0380088cdc499b83337046eb4c0300040ed20d00f33300d002375c60380026eb8c060004dd5980a98209baa30153041375402c6eacc054c104dd5182218209baa0011533303f533303f300d02014a0266607e941282511533303f01c14a0266607e941282511616163003330123758601060806ea80cc8cdd7980c98209baa00103a1616132533303f30310031325333040302d3041375400226464a666084606060866ea80044c8cc02400454ccc10ccc0280e009c54ccc10ccc030dd5980c98229baa3019304537540346eacc064c114dd50018a999821a9998218100a5013330434a0941288a9998219980280f0110a99982199b8f375c603a608a6ea800409c54ccc10ccdc79bae30193045375400204c2a66608666e3cdd7180698229baa001025153330433371e6eb8c048c114dd50008120a99982199b87375a6028608a6ea800408854ccc10ccdc39bad3013304537540020462a66608666e1cdd6980a98229baa00102115333043303530443754602c608a6ea800454ccc10cc0d4c110dd5180598229baa001101f133304301f4a09445280a5014a029405280a5014a0294058585858c11cc110dd50008b180598219baa0013045304237540022c6008660266eb0c024c104dd501a119baf301a3042375400202a2a66607e66e1d20060031533303f330060340231533303f3300201a01f1533303f300d0201533303f01b14a0266607e9412825114a029405854ccc0fcc0b400c4c94ccc100c0b4c104dd5000899192999821181818219baa00113233009001153330433300a038027153330433300c37566032608a6ea8c064c114dd500d1bab3019304537540062a6660860402a66608666e3cdd7180e98229baa001027153330433371e6eb8c064c114dd50008130a99982199b8f375c601a608a6ea800409454ccc10ccdc79bae3012304537540020482a66608666e1cdd6980998229baa001023153330433370e6eb4c050c114dd50008110a99982199b87375a602a608a6ea800408454ccc10d4ccc10cc0d4c110dd5180b18229baa00114a0266608694128251153330433035304437546016608a6ea8004407c4ccc10c07d2825114a029405280a5014a029405280a501616163047304437540022c601660866ea8004c114c108dd50008b1802198099bac300930413754068466ebcc068c108dd500080a8a99981f99b874802000c54ccc0fc07054ccc0fc06c54ccc0fd4ccc0fcc034080528099981fa504a094454ccc0fccc0080680744c8c94ccc104cdc4a4004600207a2a66608266e21200003f13371207e6002646600200207c44a66608c002297ae01332253330453300c03a0021330493752004660080080022660080080026eb8c120004c1240045858c004004894ccc1100045200013370090011980100118238008b0b0b0b0a99981f99b874802800c4c94ccc100c0b4c104dd5000899192999821181818219baa00113233009001153330433300a0380261533304353330433300501e02314a22a6660866600a03c0422a666086602204829404ccc10d282504a2294054ccc10d4ccc10c07c5280999821a504a094454ccc10ccc030dd5980c98229baa3019304537540346eacc064c114dd50018a999821a99982198089bae30123045375400229404ccc10d282504a22a66608666e3cdd7180e98229baa001027153330433371e6eb8c064c114dd50008130a99982199b8f375c601a608a6ea800409454ccc10ccdc39bad3014304537540020442a66608666e1cdd6980998229baa001023153330433370e6eb4c054c114dd50008108a999821a999821981a98221baa30163045375400220402666086040941288981a98221baa300b3045375400229405280a5014a029405280a5016161616163047304437540022c601660866ea8004c114c108dd50008b1802198099bac300930413754068466ebcc068c108dd500080a8992999820181698209baa001132325333042303030433754002264660120022a6660866601407004c2a666086660186eacc064c114dd5180c98229baa01a37566032608a6ea800c54ccc10c07c54ccc10cc044dd7180918229baa001153330433371e6eb8c074c114dd50008138a99982199b8f375c6032608a6ea800409854ccc10ccdc79bae300d3045375400204a2a66608666e1cdd6980998229baa001023153330433370e6eb4c050c114dd50008110a99982199b87375a602a608a6ea800408454ccc10d4ccc10cc0d4c110dd5180b18229baa001102013330430204a094454ccc10cc0d4c110dd5180598229baa00114a026660869412825114a029405280a5014a029405280b0b0b0b182398221baa00116300b30433754002608a60846ea800458c010cc04cdd6180498209baa03423375e603460846ea800405488c94ccc104c0ccc108dd5000899b88375a608c60866ea8004008528180d18211baa3016304237540044464a666080606460826ea80044cdc48011bad3045304237540022940c064c104dd5180c98209baa002303d37540604a66607e002298103d87a8000130153304030410014bd7011299981e1814981e9baa0021323232323232323232323232323232323232533305130540020131632533305130500011533304e33712900218278008b0982018278008b1baa3052001305200232533304f304e0011533304c33712900218268008b0981f18268008b1baa30500013050002375a609c002609c0046eb4c130004c130008dd6982500098250011bae30480013048002375c608c002608c0046eb8c110004c110008dd71821000981f1baa0021622323300100137586008607c6ea800c894ccc10000452809991299981f99b8f00200514a22660080080026eb8c108004c10c0048c0f8c0fcc0fcc0fcc0fcc0fcc0fcc0fcc0fc00488cc014c0180088cdc49bad3004001333005002375c60280026eb8c0400048c0f0c0f4c0f4004888c94ccc0e4c0acc0e8dd50008a400026eb4c0f8c0ecdd500099299981c9815981d1baa00114c0103d87a8000132330010013756607e60786ea8008894ccc0f8004530103d87a8000132333222533303f337220100062a66607e66e3c02000c4c060cc10cdd400125eb80530103d87a8000133006006001375c607a0026eb4c0f8004c108008c100004c8cc004004010894ccc0f40045300103d87a8000132333222533303e337220100062a66607c66e3c02000c4c05ccc108dd300125eb80530103d87a8000133006006001375c60780026eacc0f4004c104008c0fc00488c8cc00400400c894ccc0ec00452889991299981d18028010998020020008a503758607a002607c0024646600200200444a666072002297ae0132333222323300100100322533303f001100313233041374e660826ea4018cc104c0f8004cc104c0fc0052f5c066006006608600460820026eb8c0e0004dd5981c80099801801981e801181d800918101b8d001230373038303830380012303630373037303730370012303530363036303630363036001230343035303530353035303530350012303330343034303430343034303430340011622323300100100322533303300114bd70099912999819180280109981b00119802002000899802002000981a800981b000980298169baa3001302d3754004460606062002605c60566ea800458c8cc004004dd6180198159baa01e22533302d00114c0103d87a800013322533302c3375e600c605c6ea80080704c014cc0c00092f5c0266008008002605e00260600026e9520002302c001302a302b302b302b302b302b302b302b30273754034602c604a6ea8c0a4c0a8024c054c090dd518140041bad3027008375a604c0106eb4c094020dd718120041bae3023008375c60440106eb8c084020c084004c080004c07c004c078004c074004c070004c06c004c058dd5180c980b1baa00316370e90001b8748010c054004c054c058004c044dd50011b874800858c048c04c00cc044008c040008c040004c02cdd50008a4c26cac6eb4004dd60009bad0015734aae7555cf2ab9f5740ae855d101",
		hash: "578790512bdd1cfc39b3ea76dc8de086c55f4785589e946961273004"
	},
	{
		title: "vested_pay.vested_pay.else",
		redeemer: {
			schema: {
			}
		},
		parameters: [
			{
				title: "required_admins_multi_sig",
				schema: {
					$ref: "#/definitions/Int"
				}
			},
			{
				title: "admin_vks",
				schema: {
					$ref: "#/definitions/List$VerificationKeyHash"
				}
			},
			{
				title: "fee_address",
				schema: {
					$ref: "#/definitions/cardano~1address~1Address"
				}
			},
			{
				title: "fee_permille",
				schema: {
					$ref: "#/definitions/Int"
				}
			}
		],
		compiledCode: "590cd501010032323232323232232232223225333009323232323253323300f300130103754004264664464646464a66602c60060022a66603260306ea80280085854ccc058c02000454ccc064c060dd50050010b0a99980b18020008a99980c980c1baa00a00216153330163370e90030008a99980c980c1baa00a00216153330163370e90040008a99980c980c1baa00a00216153330163370e90050008a99980c980c1baa00a00216153330163370e90060008a99980c980c1baa00a0021616301637540122a6660286002602a6ea800c4c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c94ccc0a4c058c0a8dd50008991919192999816980f99918008009129998190008a4000266e012002330020023035001330013758600e605e6ea80888cdd7980418181baa30043030375400200626464646464646464646464646464646464a66607c60560042a66607c6600a0660422a66607c6600203203a264a66607e605860806ea800454ccc0fccc88cc034c0380088cdc499b83337046eb4c0300040ed20d00f33300d002375c60380026eb8c060004dd5980a98209baa30153041375402c6eacc054c104dd5182218209baa0011533303f533303f300d02014a0266607e941282511533303f01c14a0266607e941282511616163003330123758601060806ea80cc8cdd7980c98209baa00103a1616132533303f30310031325333040302d3041375400226464a666084606060866ea80044c8cc02400454ccc10ccc0280e009c54ccc10ccc030dd5980c98229baa3019304537540346eacc064c114dd50018a999821a9998218100a5013330434a0941288a9998219980280f0110a99982199b8f375c603a608a6ea800409c54ccc10ccdc79bae30193045375400204c2a66608666e3cdd7180698229baa001025153330433371e6eb8c048c114dd50008120a99982199b87375a6028608a6ea800408854ccc10ccdc39bad3013304537540020462a66608666e1cdd6980a98229baa00102115333043303530443754602c608a6ea800454ccc10cc0d4c110dd5180598229baa001101f133304301f4a09445280a5014a029405280a5014a0294058585858c11cc110dd50008b180598219baa0013045304237540022c6008660266eb0c024c104dd501a119baf301a3042375400202a2a66607e66e1d20060031533303f330060340231533303f3300201a01f1533303f300d0201533303f01b14a0266607e9412825114a029405854ccc0fcc0b400c4c94ccc100c0b4c104dd5000899192999821181818219baa00113233009001153330433300a038027153330433300c37566032608a6ea8c064c114dd500d1bab3019304537540062a6660860402a66608666e3cdd7180e98229baa001027153330433371e6eb8c064c114dd50008130a99982199b8f375c601a608a6ea800409454ccc10ccdc79bae3012304537540020482a66608666e1cdd6980998229baa001023153330433370e6eb4c050c114dd50008110a99982199b87375a602a608a6ea800408454ccc10d4ccc10cc0d4c110dd5180b18229baa00114a0266608694128251153330433035304437546016608a6ea8004407c4ccc10c07d2825114a029405280a5014a029405280a501616163047304437540022c601660866ea8004c114c108dd50008b1802198099bac300930413754068466ebcc068c108dd500080a8a99981f99b874802000c54ccc0fc07054ccc0fc06c54ccc0fd4ccc0fcc034080528099981fa504a094454ccc0fccc0080680744c8c94ccc104cdc4a4004600207a2a66608266e21200003f13371207e6002646600200207c44a66608c002297ae01332253330453300c03a0021330493752004660080080022660080080026eb8c120004c1240045858c004004894ccc1100045200013370090011980100118238008b0b0b0b0a99981f99b874802800c4c94ccc100c0b4c104dd5000899192999821181818219baa00113233009001153330433300a0380261533304353330433300501e02314a22a6660866600a03c0422a666086602204829404ccc10d282504a2294054ccc10d4ccc10c07c5280999821a504a094454ccc10ccc030dd5980c98229baa3019304537540346eacc064c114dd50018a999821a99982198089bae30123045375400229404ccc10d282504a22a66608666e3cdd7180e98229baa001027153330433371e6eb8c064c114dd50008130a99982199b8f375c601a608a6ea800409454ccc10ccdc39bad3014304537540020442a66608666e1cdd6980998229baa001023153330433370e6eb4c054c114dd50008108a999821a999821981a98221baa30163045375400220402666086040941288981a98221baa300b3045375400229405280a5014a029405280a5016161616163047304437540022c601660866ea8004c114c108dd50008b1802198099bac300930413754068466ebcc068c108dd500080a8992999820181698209baa001132325333042303030433754002264660120022a6660866601407004c2a666086660186eacc064c114dd5180c98229baa01a37566032608a6ea800c54ccc10c07c54ccc10cc044dd7180918229baa001153330433371e6eb8c074c114dd50008138a99982199b8f375c6032608a6ea800409854ccc10ccdc79bae300d3045375400204a2a66608666e1cdd6980998229baa001023153330433370e6eb4c050c114dd50008110a99982199b87375a602a608a6ea800408454ccc10d4ccc10cc0d4c110dd5180b18229baa001102013330430204a094454ccc10cc0d4c110dd5180598229baa00114a026660869412825114a029405280a5014a029405280b0b0b0b182398221baa00116300b30433754002608a60846ea800458c010cc04cdd6180498209baa03423375e603460846ea800405488c94ccc104c0ccc108dd5000899b88375a608c60866ea8004008528180d18211baa3016304237540044464a666080606460826ea80044cdc48011bad3045304237540022940c064c104dd5180c98209baa002303d37540604a66607e002298103d87a8000130153304030410014bd7011299981e1814981e9baa0021323232323232323232323232323232323232533305130540020131632533305130500011533304e33712900218278008b0982018278008b1baa3052001305200232533304f304e0011533304c33712900218268008b0981f18268008b1baa30500013050002375a609c002609c0046eb4c130004c130008dd6982500098250011bae30480013048002375c608c002608c0046eb8c110004c110008dd71821000981f1baa0021622323300100137586008607c6ea800c894ccc10000452809991299981f99b8f00200514a22660080080026eb8c108004c10c0048c0f8c0fcc0fcc0fcc0fcc0fcc0fcc0fcc0fc00488cc014c0180088cdc49bad3004001333005002375c60280026eb8c0400048c0f0c0f4c0f4004888c94ccc0e4c0acc0e8dd50008a400026eb4c0f8c0ecdd500099299981c9815981d1baa00114c0103d87a8000132330010013756607e60786ea8008894ccc0f8004530103d87a8000132333222533303f337220100062a66607e66e3c02000c4c060cc10cdd400125eb80530103d87a8000133006006001375c607a0026eb4c0f8004c108008c100004c8cc004004010894ccc0f40045300103d87a8000132333222533303e337220100062a66607c66e3c02000c4c05ccc108dd300125eb80530103d87a8000133006006001375c60780026eacc0f4004c104008c0fc00488c8cc00400400c894ccc0ec00452889991299981d18028010998020020008a503758607a002607c0024646600200200444a666072002297ae0132333222323300100100322533303f001100313233041374e660826ea4018cc104c0f8004cc104c0fc0052f5c066006006608600460820026eb8c0e0004dd5981c80099801801981e801181d800918101b8d001230373038303830380012303630373037303730370012303530363036303630363036001230343035303530353035303530350012303330343034303430343034303430340011622323300100100322533303300114bd70099912999819180280109981b00119802002000899802002000981a800981b000980298169baa3001302d3754004460606062002605c60566ea800458c8cc004004dd6180198159baa01e22533302d00114c0103d87a800013322533302c3375e600c605c6ea80080704c014cc0c00092f5c0266008008002605e00260600026e9520002302c001302a302b302b302b302b302b302b302b30273754034602c604a6ea8c0a4c0a8024c054c090dd518140041bad3027008375a604c0106eb4c094020dd718120041bae3023008375c60440106eb8c084020c084004c080004c07c004c078004c074004c070004c06c004c058dd5180c980b1baa00316370e90001b8748010c054004c054c058004c044dd50011b874800858c048c04c00cc044008c040008c040004c02cdd50008a4c26cac6eb4004dd60009bad0015734aae7555cf2ab9f5740ae855d101",
		hash: "578790512bdd1cfc39b3ea76dc8de086c55f4785589e946961273004"
	}
];
var definitions$1 = {
	Bool: {
		title: "Bool",
		anyOf: [
			{
				title: "False",
				dataType: "constructor",
				index: 0,
				fields: [
				]
			},
			{
				title: "True",
				dataType: "constructor",
				index: 1,
				fields: [
				]
			}
		]
	},
	ByteArray: {
		dataType: "bytes"
	},
	Int: {
		dataType: "integer"
	},
	List$VerificationKeyHash: {
		dataType: "list",
		items: {
			$ref: "#/definitions/VerificationKeyHash"
		}
	},
	Option$StakeCredential: {
		title: "Option",
		anyOf: [
			{
				title: "Some",
				description: "An optional value.",
				dataType: "constructor",
				index: 0,
				fields: [
					{
						$ref: "#/definitions/StakeCredential"
					}
				]
			},
			{
				title: "None",
				description: "Nothing.",
				dataType: "constructor",
				index: 1,
				fields: [
				]
			}
		]
	},
	POSIXTime: {
		title: "POSIXTime",
		dataType: "integer"
	},
	PaymentCredential: {
		title: "PaymentCredential",
		description: "A general structure for representing an on-chain `Credential`.\n\n Credentials are always one of two kinds: a direct public/private key\n pair, or a script (native or Plutus).",
		anyOf: [
			{
				title: "VerificationKey",
				dataType: "constructor",
				index: 0,
				fields: [
					{
						$ref: "#/definitions/VerificationKeyHash"
					}
				]
			},
			{
				title: "Script",
				dataType: "constructor",
				index: 1,
				fields: [
					{
						$ref: "#/definitions/ScriptHash"
					}
				]
			}
		]
	},
	ScriptHash: {
		title: "ScriptHash",
		dataType: "bytes"
	},
	StakeCredential: {
		title: "StakeCredential",
		description: "Represent a type of object that can be represented either inline (by hash)\n or via a reference (i.e. a pointer to an on-chain location).\n\n This is mainly use for capturing pointers to a stake credential\n registration certificate in the case of so-called pointer addresses.",
		anyOf: [
			{
				title: "Inline",
				dataType: "constructor",
				index: 0,
				fields: [
					{
						$ref: "#/definitions/cardano~1address~1Credential"
					}
				]
			},
			{
				title: "Pointer",
				dataType: "constructor",
				index: 1,
				fields: [
					{
						title: "slot_number",
						$ref: "#/definitions/Int"
					},
					{
						title: "transaction_index",
						$ref: "#/definitions/Int"
					},
					{
						title: "certificate_index",
						$ref: "#/definitions/Int"
					}
				]
			}
		]
	},
	VerificationKeyHash: {
		title: "VerificationKeyHash",
		dataType: "bytes"
	},
	"cardano/address/Address": {
		title: "Address",
		description: "A Cardano `Address` typically holding one or two credential references.\n\n Note that legacy bootstrap addresses (a.k.a. 'Byron addresses') are\n completely excluded from Plutus contexts. Thus, from an on-chain\n perspective only exists addresses of type 00, 01, ..., 07 as detailed\n in [CIP-0019 :: Shelley Addresses](https://github.com/cardano-foundation/CIPs/tree/master/CIP-0019/#shelley-addresses).",
		anyOf: [
			{
				title: "Address",
				dataType: "constructor",
				index: 0,
				fields: [
					{
						title: "payment_credential",
						$ref: "#/definitions/PaymentCredential"
					},
					{
						title: "stake_credential",
						$ref: "#/definitions/Option$StakeCredential"
					}
				]
			}
		]
	},
	"cardano/address/Credential": {
		title: "Credential",
		description: "A general structure for representing an on-chain `Credential`.\n\n Credentials are always one of two kinds: a direct public/private key\n pair, or a script (native or Plutus).",
		anyOf: [
			{
				title: "VerificationKey",
				dataType: "constructor",
				index: 0,
				fields: [
					{
						$ref: "#/definitions/VerificationKeyHash"
					}
				]
			},
			{
				title: "Script",
				dataType: "constructor",
				index: 1,
				fields: [
					{
						$ref: "#/definitions/ScriptHash"
					}
				]
			}
		]
	},
	"vested_pay/Action": {
		title: "Action",
		anyOf: [
			{
				title: "Withdraw",
				dataType: "constructor",
				index: 0,
				fields: [
				]
			},
			{
				title: "RequestRefund",
				dataType: "constructor",
				index: 1,
				fields: [
				]
			},
			{
				title: "CancelRefundRequest",
				dataType: "constructor",
				index: 2,
				fields: [
				]
			},
			{
				title: "WithdrawRefund",
				dataType: "constructor",
				index: 3,
				fields: [
				]
			},
			{
				title: "WithdrawDisputed",
				dataType: "constructor",
				index: 4,
				fields: [
				]
			},
			{
				title: "SubmitResult",
				dataType: "constructor",
				index: 5,
				fields: [
				]
			},
			{
				title: "CancelDenyRefund",
				dataType: "constructor",
				index: 6,
				fields: [
				]
			}
		]
	},
	"vested_pay/Datum": {
		title: "Datum",
		anyOf: [
			{
				title: "Datum",
				dataType: "constructor",
				index: 0,
				fields: [
					{
						title: "buyer",
						$ref: "#/definitions/VerificationKeyHash"
					},
					{
						title: "seller",
						$ref: "#/definitions/VerificationKeyHash"
					},
					{
						title: "reference_id",
						$ref: "#/definitions/ByteArray"
					},
					{
						title: "result_hash",
						$ref: "#/definitions/ByteArray"
					},
					{
						title: "submit_result_time",
						$ref: "#/definitions/POSIXTime"
					},
					{
						title: "unlock_time",
						$ref: "#/definitions/POSIXTime"
					},
					{
						title: "refund_time",
						$ref: "#/definitions/POSIXTime"
					},
					{
						title: "refund_requested",
						$ref: "#/definitions/Bool"
					},
					{
						title: "refund_denied",
						$ref: "#/definitions/Bool"
					}
				]
			}
		]
	}
};
var paymentPlutus = {
	preamble: preamble$1,
	validators: validators$1,
	definitions: definitions$1
};

var preamble = {
	title: "nmkr/masumi-registry",
	description: "Aiken contracts for project 'nmkr/masumi-registry'",
	version: "0.0.0",
	plutusVersion: "v3",
	compiler: {
		name: "Aiken",
		version: "v1.1.7+e2fb28b"
	},
	license: "Apache-2.0"
};
var validators = [
	{
		title: "mint.mintUnique.mint",
		redeemer: {
			title: "redeemer",
			schema: {
				$ref: "#/definitions/mint~1Action"
			}
		},
		parameters: [
			{
				title: "_paymentContractAddress",
				schema: {
					$ref: "#/definitions/ByteArray"
				}
			}
		],
		compiledCode: "59021a0101003232323232323223225333004323232323253323300a3001300b3754004264646464a66601c600a0022a66602260206ea801c0085854ccc038c00c00454ccc044c040dd50038010b0b18071baa00613232323232325333015301800213232325333015300c3016375401c264a66602c601a602e6ea80044c94ccc05ccdc78029b9432337146eb8c004c068dd51800980d1baa0023337929452008375a603a603c60346ea8c004c068dd50011180e8008a99980b9806002098060018a5014a0603660306ea800458ccc8c0040048894ccc06c0085300103d87a800013322533301a301100313374a90001980f00125eb804ccc014014004cdc0001a4002603a004603c00401090000a99980a99b87002480044c02800452819198008009980300380591299980c8008a4000266e01200233002002301c001375a602a0046eb8c04c00458c058004cc00400801888c94ccc048c01cc04cdd50008a5eb7bdb1804dd5980b980a1baa001323300100100322533301600114c103d87a800013233322253330173372200e0062a66602e66e3c01c00c4cdd2a4000660366e980092f5c02980103d87a8000133006006001375c602a0026eacc058004c068008c060004dd59809980a180a180a180a0011bac3012001300e375400c6e1d2002375c601e60186ea8008dc3a40002c601a601c006601800460160046016002600c6ea800452613656375c002ae6955ceaab9e5573eae815d0aba201",
		hash: "742e6cfa648f45cb60700e119d661979eae2fd0d13ce49fc204cedfa"
	},
	{
		title: "mint.mintUnique.else",
		redeemer: {
			schema: {
			}
		},
		parameters: [
			{
				title: "_paymentContractAddress",
				schema: {
					$ref: "#/definitions/ByteArray"
				}
			}
		],
		compiledCode: "59021a0101003232323232323223225333004323232323253323300a3001300b3754004264646464a66601c600a0022a66602260206ea801c0085854ccc038c00c00454ccc044c040dd50038010b0b18071baa00613232323232325333015301800213232325333015300c3016375401c264a66602c601a602e6ea80044c94ccc05ccdc78029b9432337146eb8c004c068dd51800980d1baa0023337929452008375a603a603c60346ea8c004c068dd50011180e8008a99980b9806002098060018a5014a0603660306ea800458ccc8c0040048894ccc06c0085300103d87a800013322533301a301100313374a90001980f00125eb804ccc014014004cdc0001a4002603a004603c00401090000a99980a99b87002480044c02800452819198008009980300380591299980c8008a4000266e01200233002002301c001375a602a0046eb8c04c00458c058004cc00400801888c94ccc048c01cc04cdd50008a5eb7bdb1804dd5980b980a1baa001323300100100322533301600114c103d87a800013233322253330173372200e0062a66602e66e3c01c00c4cdd2a4000660366e980092f5c02980103d87a8000133006006001375c602a0026eacc058004c068008c060004dd59809980a180a180a180a0011bac3012001300e375400c6e1d2002375c601e60186ea8008dc3a40002c601a601c006601800460160046016002600c6ea800452613656375c002ae6955ceaab9e5573eae815d0aba201",
		hash: "742e6cfa648f45cb60700e119d661979eae2fd0d13ce49fc204cedfa"
	}
];
var definitions = {
	ByteArray: {
		dataType: "bytes"
	},
	"mint/Action": {
		title: "Action",
		anyOf: [
			{
				title: "MintAction",
				dataType: "constructor",
				index: 0,
				fields: [
				]
			},
			{
				title: "BurnAction",
				dataType: "constructor",
				index: 1,
				fields: [
				]
			}
		]
	}
};
var registryPlutus = {
	preamble: preamble,
	validators: validators,
	definitions: definitions
};

async function getPaymentScriptFromNetworkHandlerV1(networkCheckSupported) {
  const adminWallets = networkCheckSupported.AdminWallets;
  if (adminWallets.length != 3)
    throw new Error("Invalid admin wallets");
  const sortedAdminWallets = adminWallets.sort((a, b) => a.order - b.order);
  const admin1 = sortedAdminWallets[0];
  const admin2 = sortedAdminWallets[1];
  const admin3 = sortedAdminWallets[2];
  const feeWallet = networkCheckSupported.FeeReceiverNetworkWallet;
  return await getPaymentScriptV1(admin1.walletAddress, admin2.walletAddress, admin3.walletAddress, feeWallet.walletAddress, networkCheckSupported.feePermille, networkCheckSupported.network);
}
async function getRegistryScriptFromNetworkHandlerV1(networkCheckSupported) {
  return await getRegistryScriptV1(networkCheckSupported.paymentContractAddress, networkCheckSupported.network);
}
async function getPaymentScriptV1(adminWalletAddress1, adminWalletAddress2, adminWalletAddress3, feeWalletAddress, feePermille, network) {
  if (feePermille < 0 || feePermille > 1e3)
    throw new Error("Fee permille must be between 0 and 1000");
  const script = {
    code: applyParamsToScript(paymentPlutus.validators[0].compiledCode, [
      2,
      [
        resolvePaymentKeyHash$1(adminWalletAddress1),
        resolvePaymentKeyHash$1(adminWalletAddress2),
        resolvePaymentKeyHash$1(adminWalletAddress3)
      ],
      //yes I love meshJs
      {
        alternative: 0,
        fields: [
          {
            alternative: 0,
            fields: [resolvePaymentKeyHash$1(feeWalletAddress)]
          },
          {
            alternative: 0,
            fields: [
              {
                alternative: 0,
                fields: [
                  {
                    alternative: 0,
                    fields: [resolveStakeKeyHash(feeWalletAddress)]
                  }
                ]
              }
            ]
          }
        ]
      },
      feePermille
    ]),
    version: "V3"
  };
  const networkId = convertNetworkToId(network);
  const smartContractAddress = resolvePlutusScriptAddress(script, networkId);
  return { script, smartContractAddress };
}
async function getRegistryScriptV1(contractAddress, network) {
  const script = {
    code: applyParamsToScript(registryPlutus.validators[0].compiledCode, [
      contractAddress
    ]),
    version: "V3"
  };
  const policyId = deserializePlutusScript(script.code, script.version).hash().toString();
  const networkId = convertNetworkToId(network);
  const smartContractAddress = resolvePlutusScriptAddress(script, networkId);
  return { script, policyId, smartContractAddress };
}

const updateMutex$4 = new Sema(1);
async function collectOutstandingPaymentsV1() {
  const acquiredMutex = await updateMutex$4.tryAcquire();
  if (!acquiredMutex)
    return await updateMutex$4.acquire();
  try {
    const networkChecksWithWalletLocked = await prisma.$transaction(async (prisma2) => {
      const networkChecks = await prisma2.networkHandler.findMany({
        where: {
          paymentType: "WEB3_CARDANO_V1"
        },
        include: {
          PaymentRequests: {
            where: {
              unlockTime: {
                gte: Date.now() + 1e3 * 60 * 15
                //add 15 minutes for block time
              },
              status: "CompletedConfirmed",
              resultHash: { not: null },
              errorType: null,
              SmartContractWallet: {
                PendingTransaction: null
              }
            },
            include: { BuyerWallet: true, SmartContractWallet: { where: { PendingTransaction: null }, include: { WalletSecret: true } } }
          },
          AdminWallets: true,
          FeeReceiverNetworkWallet: true,
          CollectionWallet: true
        }
      });
      const sellingWalletIds = networkChecks.map((x) => x.PaymentRequests).flat().map((x) => x.SmartContractWallet?.id);
      for (const sellingWalletId of sellingWalletIds) {
        await prisma2.sellingWallet.update({
          where: { id: sellingWalletId },
          data: { PendingTransaction: { create: { hash: null } } }
        });
      }
      return networkChecks;
    }, { isolationLevel: "Serializable" });
    await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {
      if (networkCheck.PaymentRequests.length == 0 || networkCheck.CollectionWallet == null)
        return;
      const network = convertNetwork(networkCheck.network);
      const networkId = convertNetworkToId(networkCheck.network);
      const blockchainProvider = new BlockfrostProvider(networkCheck.rpcProviderApiKey, void 0);
      const paymentRequests = networkCheck.PaymentRequests;
      if (paymentRequests.length == 0)
        return;
      const deDuplicatedRequests = [];
      for (const request of paymentRequests) {
        if (request.smartContractWalletId == null)
          continue;
        if (deDuplicatedRequests.some((r) => r.smartContractWalletId == request.smartContractWalletId))
          continue;
        deDuplicatedRequests.push(request);
      }
      await Promise.allSettled(deDuplicatedRequests.map(async (request) => {
        try {
          const sellingWallet = request.SmartContractWallet;
          const encryptedSecret = sellingWallet.WalletSecret.secret;
          const wallet = new MeshWallet({
            networkId,
            fetcher: blockchainProvider,
            submitter: blockchainProvider,
            key: {
              type: "mnemonic",
              words: decrypt(encryptedSecret).split(" ")
            }
          });
          const address = (await wallet.getUnusedAddresses())[0];
          const { script, smartContractAddress } = await getPaymentScriptFromNetworkHandlerV1(networkCheck);
          const utxos = await wallet.getUtxos();
          if (utxos.length === 0) {
            throw new Error("No UTXOs found in the wallet. Wallet is empty.");
          }
          const utxoByHash = await blockchainProvider.fetchUTxOs(
            request.txHash
          );
          const utxo = utxoByHash.find((utxo2) => utxo2.input.txHash == request.txHash);
          if (!utxo) {
            throw new Error("UTXO not found");
          }
          const buyerVerificationKeyHash = request.BuyerWallet?.walletVkey;
          const sellerVerificationKeyHash = request.SmartContractWallet.walletVkey;
          const utxoDatum = utxo.output.plutusData;
          if (!utxoDatum) {
            throw new Error("No datum found in UTXO");
          }
          const decodedDatum = cbor.decode(Buffer.from(utxoDatum, "hex"));
          if (typeof decodedDatum.value[4] !== "number") {
            throw new Error("Invalid datum at position 4");
          }
          if (typeof decodedDatum.value[5] !== "number") {
            throw new Error("Invalid datum at position 5");
          }
          const submitResultTime = decodedDatum.value[4];
          const unlockTime = decodedDatum.value[5];
          const refundTime = decodedDatum.value[6];
          const hashedValue = request.resultHash;
          const datum = {
            value: {
              alternative: 0,
              fields: [
                buyerVerificationKeyHash,
                sellerVerificationKeyHash,
                request.identifier,
                hashedValue,
                submitResultTime,
                unlockTime,
                refundTime,
                //is converted to false
                mBool(false),
                //is converted to false
                mBool(false)
              ]
            },
            inline: true
          };
          const redeemer = {
            data: {
              alternative: 0,
              fields: []
            }
          };
          const invalidBefore = unixTimeToEnclosingSlot(Date.now() - 15e4, SLOT_CONFIG_NETWORK[network]) - 1;
          const invalidAfter = unixTimeToEnclosingSlot(Date.now() + 15e4, SLOT_CONFIG_NETWORK[network]) + 1;
          const remainingAssets = {};
          const feeAssets = {};
          for (const assetValue of utxo.output.amount) {
            const assetKey = assetValue.unit;
            let minFee = 0;
            if (assetValue.unit == "lovelace") {
              minFee = 1435230;
            }
            const value = BigInt(assetValue.quantity);
            const feeValue = BigInt(Math.max(minFee, Number(value) * networkCheck.feePermille / 1e3));
            const remainingValue = value - feeValue;
            const remainingValueAsset = {
              unit: assetValue.unit,
              quantity: remainingValue.toString()
            };
            if (BigInt(remainingValueAsset.quantity) > 0) {
              remainingAssets[assetKey] = remainingValueAsset;
            } else {
              delete remainingAssets[assetKey];
            }
            const feeValueAsset = {
              unit: assetValue.unit,
              quantity: feeValue.toString()
            };
            if (BigInt(feeValueAsset.quantity) > 0) {
              feeAssets[assetKey] = feeValueAsset;
            } else {
              delete feeAssets[assetKey];
            }
          }
          if (networkCheck.CollectionWallet == null) {
            await prisma.paymentRequest.update({
              where: { id: request.id },
              data: { errorType: "UNKNOWN", errorRequiresManualReview: true, errorNote: "Collection wallet not found" }
            });
            throw new Error("Collection wallet not found");
          }
          const unsignedTx = new Transaction$1({ initiator: wallet }).setMetadata(674, {
            msg: ["Masumi", "Completed"]
          }).redeemValue({
            value: utxo,
            script,
            redeemer
          }).sendAssets(
            {
              address: networkCheck.CollectionWallet.walletAddress,
              datum
            },
            Object.values(remainingAssets)
          ).sendAssets(
            {
              address: networkCheck.FeeReceiverNetworkWallet.walletAddress,
              datum
            },
            Object.values(feeAssets)
          ).setChangeAddress(address).setRequiredSigners([address]);
          unsignedTx.txBuilder.invalidBefore(invalidBefore);
          unsignedTx.txBuilder.invalidHereafter(invalidAfter);
          const buildTransaction = await unsignedTx.build();
          const signedTx = await wallet.signTx(buildTransaction);
          const txHash = await wallet.submitTx(signedTx);
          await prisma.paymentRequest.update({
            where: { id: request.id },
            data: {
              potentialTxHash: txHash,
              status: $Enums.PaymentRequestStatus.CompletedInitiated,
              SmartContractWallet: { update: { PendingTransaction: { update: { hash: txHash } } } }
            }
          });
          logger.info(`Created withdrawal transaction:
                  Tx ID: ${txHash}
                  View (after a bit) on https://${network === "preprod" ? "preprod." : ""}cardanoscan.io/transaction/${txHash}
                  Smart Contract Address: ${smartContractAddress}
              `);
        } catch (error) {
          logger.error(`Error creating collection transaction: ${error}`);
          if (request.errorRetries == null || request.errorRetries < networkCheck.maxCollectionRetries) {
            await prisma.paymentRequest.update({
              where: { id: request.id },
              data: { errorRetries: { increment: 1 } }
            });
          } else {
            const errorMessage = "Error creating refund transaction: " + (error instanceof Error ? error.message : typeof error === "object" && error ? error.toString() : "Unknown Error");
            await prisma.paymentRequest.update({
              where: { id: request.id },
              data: {
                errorType: "UNKNOWN",
                errorRequiresManualReview: true,
                errorNote: errorMessage
              }
            });
          }
        }
      }));
    }));
  } finally {
    updateMutex$4.release();
  }
}

const updateMutex$3 = new Sema(1);
async function collectRefundV1() {
  const acquiredMutex = await updateMutex$3.tryAcquire();
  if (!acquiredMutex)
    return await updateMutex$3.acquire();
  try {
    const networkChecksWithWalletLocked = await prisma.$transaction(async (prisma2) => {
      const networkChecks = await prisma2.networkHandler.findMany({
        where: {
          paymentType: "WEB3_CARDANO_V1"
        },
        include: {
          PurchaseRequests: {
            where: {
              refundTime: {
                gte: Date.now() + 1e3 * 60 * 15
                //add 15 minutes for block time
              },
              status: "RefundRequestConfirmed",
              resultHash: null,
              errorType: null,
              SmartContractWallet: { PendingTransaction: null }
            },
            include: { SmartContractWallet: { include: { WalletSecret: true } } }
          },
          AdminWallets: true,
          FeeReceiverNetworkWallet: true,
          CollectionWallet: true
        }
      });
      const purchaserWalletIds = [];
      for (const networkCheck of networkChecks) {
        for (const purchaseRequest of networkCheck.PurchaseRequests) {
          if (purchaseRequest.SmartContractWallet?.id) {
            purchaserWalletIds.push(purchaseRequest.SmartContractWallet?.id);
          } else {
            logger.warn("No smart contract wallet found for purchase request", { purchaseRequest });
          }
        }
      }
      for (const purchaserWalletId of purchaserWalletIds) {
        await prisma2.purchasingWallet.update({
          where: { id: purchaserWalletId },
          data: { PendingTransaction: { create: { hash: null } } }
        });
      }
      return networkChecks;
    }, { isolationLevel: "Serializable" });
    await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {
      if (networkCheck.PurchaseRequests.length == 0 || networkCheck.CollectionWallet == null)
        return;
      const network = convertNetwork(networkCheck.network);
      const networkId = convertNetworkToId(networkCheck.network);
      const blockchainProvider = new BlockfrostProvider(networkCheck.rpcProviderApiKey, void 0);
      const purchaseRequests = networkCheck.PurchaseRequests;
      if (purchaseRequests.length == 0)
        return;
      const deDuplicatedRequests = [];
      for (const request of purchaseRequests) {
        if (request.smartContractWalletId == null)
          continue;
        if (deDuplicatedRequests.some((r) => r.smartContractWalletId == request.smartContractWalletId))
          continue;
        deDuplicatedRequests.push(request);
      }
      await Promise.allSettled(deDuplicatedRequests.map(async (request) => {
        try {
          const purchasingWallet = request.SmartContractWallet;
          const encryptedSecret = purchasingWallet.WalletSecret.secret;
          const wallet = new MeshWallet({
            networkId,
            fetcher: blockchainProvider,
            submitter: blockchainProvider,
            key: {
              type: "mnemonic",
              words: decrypt(encryptedSecret).split(" ")
            }
          });
          const address = (await wallet.getUnusedAddresses())[0];
          console.log(address);
          const { script, smartContractAddress } = await getPaymentScriptFromNetworkHandlerV1(networkCheck);
          const utxos = await wallet.getUtxos();
          if (utxos.length === 0) {
            throw new Error("No UTXOs found in the wallet. Wallet is empty.");
          }
          const utxoByHash = await blockchainProvider.fetchUTxOs(
            request.txHash
          );
          const utxo = utxoByHash.find((utxo2) => utxo2.input.txHash == request.txHash);
          if (!utxo) {
            throw new Error("UTXO not found");
          }
          const utxoDatum = utxo.output.plutusData;
          if (!utxoDatum) {
            throw new Error("No datum found in UTXO");
          }
          const decodedDatum = cbor.decode(Buffer.from(utxoDatum, "hex"));
          if (typeof decodedDatum.value[4] !== "number") {
            throw new Error("Invalid datum at position 4");
          }
          if (typeof decodedDatum.value[5] !== "number") {
            throw new Error("Invalid datum at position 5");
          }
          const redeemer = {
            data: {
              alternative: 3,
              fields: []
            }
          };
          const invalidBefore = unixTimeToEnclosingSlot(Date.now() - 15e4, SLOT_CONFIG_NETWORK[network]) - 1;
          const invalidAfter = unixTimeToEnclosingSlot(Date.now() + 15e4, SLOT_CONFIG_NETWORK[network]) + 1;
          const unsignedTx = new Transaction$1({ initiator: wallet }).setMetadata(674, {
            msg: ["Masumi", "CollectRefund"]
          }).redeemValue({
            value: utxo,
            script,
            redeemer
          }).sendAssets(
            {
              address
            },
            utxo.output.amount
          ).setChangeAddress(address).setRequiredSigners([address]);
          unsignedTx.txBuilder.invalidBefore(invalidBefore);
          unsignedTx.txBuilder.invalidHereafter(invalidAfter);
          const buildTransaction = await unsignedTx.build();
          const signedTx = await wallet.signTx(buildTransaction);
          const txHash = await wallet.submitTx(signedTx);
          await prisma.purchaseRequest.update({
            where: { id: request.id },
            data: { potentialTxHash: txHash, status: $Enums.PurchasingRequestStatus.RefundInitiated, SmartContractWallet: { update: { PendingTransaction: { create: { hash: txHash } } } } }
          });
          logger.info(`Created withdrawal transaction:
                  Tx ID: ${txHash}
                  View (after a bit) on https://${network === "preprod" ? "preprod." : ""}cardanoscan.io/transaction/${txHash}
                  Smart Contract Address: ${smartContractAddress}
              `);
        } catch (error) {
          logger.error(`Error creating refund transaction: ${error}`);
          if (request.errorRetries == null || request.errorRetries < networkCheck.maxRefundRetries) {
            await prisma.paymentRequest.update({
              where: { id: request.id },
              data: { errorRetries: { increment: 1 } }
            });
          } else {
            const errorMessage = "Error creating refund transaction: " + (error instanceof Error ? error.message : typeof error === "object" && error ? error.toString() : "Unknown Error");
            await prisma.paymentRequest.update({
              where: { id: request.id },
              data: {
                errorType: "UNKNOWN",
                errorRequiresManualReview: true,
                errorNote: errorMessage
              }
            });
          }
        }
      }));
    }));
  } finally {
    updateMutex$3.release();
  }
}
const cardanoRefundHandlerService = { collectRefundV1 };

const updateMutex$2 = new Sema(1);
async function submitResultV1() {
  const acquiredMutex = await updateMutex$2.tryAcquire();
  if (!acquiredMutex)
    return await updateMutex$2.acquire();
  try {
    const networkChecksWithWalletLocked = await prisma.$transaction(async (prisma2) => {
      const networkChecks = await prisma2.networkHandler.findMany({
        where: {
          paymentType: "WEB3_CARDANO_V1"
        },
        include: {
          PaymentRequests: {
            where: {
              //the smart contract requires the result hash to be provided before the result time
              submitResultTime: {
                lte: Date.now() - 1e3 * 60 * 1
                //remove 1 minute for block time
              },
              status: { in: ["PaymentConfirmed", "RefundRequested"] },
              resultHash: { not: null },
              errorType: null,
              SmartContractWallet: { PendingTransaction: null }
            },
            include: { BuyerWallet: true, SmartContractWallet: { include: { WalletSecret: true } } }
          },
          AdminWallets: true,
          FeeReceiverNetworkWallet: true,
          CollectionWallet: true
        }
      });
      const sellingWalletIds = networkChecks.map((x) => x.PaymentRequests).flat().map((x) => x.SmartContractWallet?.id);
      for (const sellingWalletId of sellingWalletIds) {
        await prisma2.sellingWallet.update({
          where: { id: sellingWalletId },
          data: { PendingTransaction: { create: { hash: null } } }
        });
      }
      return networkChecks;
    }, { isolationLevel: "Serializable" });
    await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {
      if (networkCheck.PaymentRequests.length == 0 || networkCheck.CollectionWallet == null)
        return;
      const network = convertNetwork(networkCheck.network);
      const networkId = convertNetworkToId(networkCheck.network);
      const blockchainProvider = new BlockfrostProvider(networkCheck.rpcProviderApiKey, void 0);
      const paymentRequests = networkCheck.PaymentRequests;
      if (paymentRequests.length == 0)
        return;
      const deDuplicatedRequests = [];
      for (const request of paymentRequests) {
        if (request.smartContractWalletId == null)
          continue;
        if (deDuplicatedRequests.some((r) => r.smartContractWalletId == request.smartContractWalletId))
          continue;
        deDuplicatedRequests.push(request);
      }
      await Promise.allSettled(deDuplicatedRequests.map(async (request) => {
        try {
          const sellingWallet = request.SmartContractWallet;
          const encryptedSecret = sellingWallet.WalletSecret.secret;
          const wallet = new MeshWallet({
            networkId,
            fetcher: blockchainProvider,
            submitter: blockchainProvider,
            key: {
              type: "mnemonic",
              words: decrypt(encryptedSecret).split(" ")
            }
          });
          const address = (await wallet.getUnusedAddresses())[0];
          console.log(address);
          const { script, smartContractAddress } = await getPaymentScriptFromNetworkHandlerV1(networkCheck);
          const utxos = await wallet.getUtxos();
          if (utxos.length === 0) {
            throw new Error("No UTXOs found in the wallet. Wallet is empty.");
          }
          const utxoByHash = await blockchainProvider.fetchUTxOs(
            request.txHash
          );
          const utxo = utxoByHash.find((utxo2) => utxo2.input.txHash == request.txHash);
          if (!utxo) {
            throw new Error("UTXO not found");
          }
          const buyerVerificationKeyHash = request.BuyerWallet?.walletVkey;
          const sellerVerificationKeyHash = request.SmartContractWallet.walletVkey;
          const utxoDatum = utxo.output.plutusData;
          if (!utxoDatum) {
            throw new Error("No datum found in UTXO");
          }
          const decodedDatum = cbor.decode(Buffer.from(utxoDatum, "hex"));
          if (typeof decodedDatum.value[4] !== "number") {
            throw new Error("Invalid datum at position 4");
          }
          if (typeof decodedDatum.value[5] !== "number") {
            throw new Error("Invalid datum at position 5");
          }
          const submitResultTime = decodedDatum.value[4];
          const unlockTime = decodedDatum.value[5];
          const refundTime = decodedDatum.value[6];
          const datum = {
            value: {
              alternative: 0,
              fields: [
                buyerVerificationKeyHash,
                sellerVerificationKeyHash,
                request.identifier,
                request.resultHash,
                submitResultTime,
                unlockTime,
                refundTime,
                //is converted to false
                mBool(false),
                //is converted to false
                mBool(true)
              ]
            },
            inline: true
          };
          const redeemer = {
            data: {
              alternative: 5,
              fields: []
            }
          };
          const invalidBefore = unixTimeToEnclosingSlot(Date.now() - 15e4, SLOT_CONFIG_NETWORK[network]) - 1;
          const invalidAfter = unixTimeToEnclosingSlot(Date.now() + 15e4, SLOT_CONFIG_NETWORK[network]) + 1;
          const unsignedTx = new Transaction$1({ initiator: wallet }).setMetadata(674, {
            msg: ["Masumi", "SubmitResult"]
          }).redeemValue({
            value: utxo,
            script,
            redeemer
          }).sendAssets(
            {
              address: smartContractAddress,
              datum
            },
            utxo.output.amount
          ).setChangeAddress(address).setRequiredSigners([address]);
          unsignedTx.txBuilder.invalidBefore(invalidBefore);
          unsignedTx.txBuilder.invalidHereafter(invalidAfter);
          const buildTransaction = await unsignedTx.build();
          const signedTx = await wallet.signTx(buildTransaction);
          const txHash = await wallet.submitTx(signedTx);
          await prisma.paymentRequest.update({
            where: { id: request.id },
            data: { potentialTxHash: txHash, status: $Enums.PaymentRequestStatus.CompletedInitiated, SmartContractWallet: { update: { PendingTransaction: { create: { hash: txHash } } } } }
          });
          logger.info(`Created withdrawal transaction:
                  Tx ID: ${txHash}
                  View (after a bit) on https://${network === "preprod" ? "preprod." : ""}cardanoscan.io/transaction/${txHash}
                  Smart Contract Address: ${smartContractAddress}
              `);
        } catch (error) {
          logger.error(`Error creating refund transaction: ${error}`);
          if (request.errorRetries == null || request.errorRetries < networkCheck.maxCollectRefundRetries) {
            await prisma.paymentRequest.update({
              where: { id: request.id },
              data: { errorRetries: { increment: 1 } }
            });
          } else {
            const errorMessage = "Error creating refund transaction: " + (error instanceof Error ? error.message : typeof error === "object" && error ? error.toString() : "Unknown Error");
            await prisma.paymentRequest.update({
              where: { id: request.id },
              data: {
                errorType: "UNKNOWN",
                errorRequiresManualReview: true,
                errorNote: errorMessage
              }
            });
          }
        }
      }));
    }));
  } finally {
    updateMutex$2.release();
  }
}
const cardanoSubmitResultHandlerService = { submitResultV1 };

const updateMutex$1 = new Sema(1);
async function updateWalletTransactionHash() {
  const acquiredMutex = await updateMutex$1.tryAcquire();
  if (!acquiredMutex)
    return await updateMutex$1.acquire();
  try {
    const lockedPurchaseWallets = await prisma.purchasingWallet.findMany({
      where: {
        PendingTransaction: {
          hash: { not: null },
          //if the transaction has been checked in the last 30 seconds, we skip it
          lastCheckedAt: { lte: new Date(Date.now() - 1e3 * 30) }
        }
      },
      include: { PendingTransaction: true, NetworkHandler: true }
    });
    await Promise.allSettled(lockedPurchaseWallets.map(async (wallet) => {
      try {
        const txHash = wallet.PendingTransaction.hash;
        const blockfrostKey = wallet.NetworkHandler.rpcProviderApiKey;
        const provider = new BlockfrostProvider(blockfrostKey);
        const txInfo = await provider.fetchTxInfo(txHash);
        if (txInfo) {
          await prisma.purchasingWallet.update({
            where: { id: wallet.id },
            data: { PendingTransaction: { delete: true } }
          });
        } else {
          await prisma.transaction.update({
            where: { id: wallet.PendingTransaction?.id },
            data: { lastCheckedAt: /* @__PURE__ */ new Date() }
          });
        }
      } catch (error) {
        logger.error(`Error updating wallet transaction hash: ${error}`);
      }
    }));
    const timedOutLockedPurchaseWallets = await prisma.purchasingWallet.findMany({
      where: {
        PendingTransaction: {
          updatedAt: {
            //wallets that have not been updated in the last 5 minutes
            lt: new Date(Date.now() - 1e3 * 60 * 5)
          }
        }
      },
      include: { PendingTransaction: true }
    });
    await Promise.allSettled(timedOutLockedPurchaseWallets.map(async (wallet) => {
      try {
        const txHash = wallet.PendingTransaction?.hash;
        if (txHash) {
          await prisma.purchaseRequest.updateMany({
            where: {
              potentialTxHash: txHash
            },
            data: { errorRequiresManualReview: true, errorNote: "Transaction timeout", errorType: $Enums.PaymentRequestErrorType.UNKNOWN }
          });
        }
        await prisma.purchasingWallet.update({
          where: { id: wallet.id },
          data: { PendingTransaction: { delete: true } }
        });
      } catch (error) {
        logger.error(`Error updating timed out wallet: ${error}`);
      }
    }));
    if (timedOutLockedPurchaseWallets.length > 0 || lockedPurchaseWallets.length > 0) {
      try {
        await cardanoRefundHandlerService.collectRefundV1();
      } catch (error) {
        logger.error(`Error initiating refunds: ${error}`);
      }
      try {
        await cardanoSubmitResultHandlerService.submitResultV1();
      } catch (error) {
        logger.error(`Error initiating refunds: ${error}`);
      }
    }
    const lockedSellingWallets = await prisma.sellingWallet.findMany({
      where: {
        PendingTransaction: {
          hash: { not: null },
          lastCheckedAt: { lt: new Date(Date.now() - 1e3 * 60 * 20) }
        }
      },
      include: { PendingTransaction: true, NetworkHandler: true }
    });
    await Promise.allSettled(lockedSellingWallets.map(async (wallet) => {
      try {
        const txHash = wallet.PendingTransaction.hash;
        const blockfrostKey = wallet.NetworkHandler.rpcProviderApiKey;
        const provider = new BlockfrostProvider(blockfrostKey);
        const txInfo = await provider.fetchTxInfo(txHash);
        if (txInfo) {
          await prisma.sellingWallet.update({
            where: { id: wallet.id },
            data: { PendingTransaction: { delete: true } }
          });
        } else {
          await prisma.transaction.update({
            where: { id: wallet.PendingTransaction?.id },
            data: { lastCheckedAt: /* @__PURE__ */ new Date() }
          });
        }
      } catch (error) {
        logger.error(`Error updating selling wallet: ${error}`);
      }
    }));
    const timedOutLockedSellingWallets = await prisma.sellingWallet.findMany({
      where: {
        PendingTransaction: {
          updatedAt: { lt: new Date(Date.now() - 1e3 * 60 * 5) }
        }
      },
      include: { PendingTransaction: true }
    });
    await Promise.allSettled(timedOutLockedSellingWallets.map(async (wallet) => {
      try {
        const txHash = wallet.PendingTransaction?.hash;
        if (txHash) {
          await prisma.paymentRequest.updateMany({
            where: { potentialTxHash: txHash },
            data: {
              errorRequiresManualReview: true,
              errorNote: "Transaction timeout",
              errorType: $Enums.PaymentRequestErrorType.UNKNOWN
            }
          });
        }
        await prisma.sellingWallet.update({
          where: { id: wallet.id },
          data: { PendingTransaction: { delete: true } }
        });
      } catch (error) {
        logger.error(`Error updating timed out selling wallet: ${error}`);
      }
    }));
    if (timedOutLockedSellingWallets.length > 0 || lockedSellingWallets.length > 0) {
    }
  } finally {
    updateMutex$1.release();
  }
}
const updateWalletTransactionHashHandlerService = { updateWalletTransactionHash };

const updateMutex = new Sema(1);
async function collectTimeoutRefundsV1() {
  const acquiredMutex = await updateMutex.tryAcquire();
  if (!acquiredMutex)
    return await updateMutex.acquire();
  try {
    const networkChecksWithWalletLocked = await prisma.$transaction(async (prisma2) => {
      const networkChecks = await prisma2.networkHandler.findMany({
        where: {
          paymentType: "WEB3_CARDANO_V1"
        },
        include: {
          PurchaseRequests: {
            where: {
              submitResultTime: {
                lte: Date.now() + 1e3 * 60 * 25
                //add 25 minutes for block time
              },
              status: "PurchaseConfirmed",
              resultHash: null,
              errorType: null,
              SmartContractWallet: { PendingTransaction: null }
            },
            include: {
              SmartContractWallet: { include: { WalletSecret: true } }
            }
          },
          AdminWallets: true,
          FeeReceiverNetworkWallet: true,
          CollectionWallet: true
        }
      });
      const purchaserWalletIds = [];
      for (const networkCheck of networkChecks) {
        for (const purchaseRequest of networkCheck.PurchaseRequests) {
          if (purchaseRequest.SmartContractWallet?.id) {
            purchaserWalletIds.push(purchaseRequest.SmartContractWallet?.id);
          } else {
            logger.warn("No smart contract wallet found for purchase request", { purchaseRequest });
          }
        }
      }
      for (const purchaserWalletId of purchaserWalletIds) {
        await prisma2.purchasingWallet.update({
          where: { id: purchaserWalletId },
          data: { PendingTransaction: { create: { hash: null } } }
        });
      }
      return networkChecks;
    }, { isolationLevel: "Serializable" });
    await Promise.allSettled(networkChecksWithWalletLocked.map(async (networkCheck) => {
      if (networkCheck.PurchaseRequests.length == 0 || networkCheck.CollectionWallet == null)
        return;
      const network = convertNetwork(networkCheck.network);
      const networkId = convertNetworkToId(networkCheck.network);
      const blockchainProvider = new BlockfrostProvider(networkCheck.rpcProviderApiKey, void 0);
      const purchaseRequests = networkCheck.PurchaseRequests;
      if (purchaseRequests.length == 0)
        return;
      const deDuplicatedRequests = [];
      for (const request of purchaseRequests) {
        if (request.smartContractWalletId == null)
          continue;
        if (deDuplicatedRequests.some((r) => r.smartContractWalletId == request.smartContractWalletId))
          continue;
        deDuplicatedRequests.push(request);
      }
      await Promise.allSettled(deDuplicatedRequests.map(async (request) => {
        try {
          const purchasingWallet = request.SmartContractWallet;
          if (purchasingWallet == null)
            throw new Error("Purchasing wallet not found");
          const encryptedSecret = purchasingWallet.WalletSecret.secret;
          const wallet = new MeshWallet({
            networkId,
            fetcher: blockchainProvider,
            submitter: blockchainProvider,
            key: {
              type: "mnemonic",
              words: decrypt(encryptedSecret).split(" ")
            }
          });
          const address = (await wallet.getUnusedAddresses())[0];
          const { script, smartContractAddress } = await getPaymentScriptFromNetworkHandlerV1(networkCheck);
          const utxos = await wallet.getUtxos();
          if (utxos.length === 0) {
            throw new Error("No UTXOs found in the wallet. Wallet is empty.");
          }
          const utxoByHash = await blockchainProvider.fetchUTxOs(
            request.txHash
          );
          const utxo = utxoByHash.find((utxo2) => utxo2.input.txHash == request.txHash);
          if (!utxo) {
            throw new Error("UTXO not found");
          }
          const utxoDatum = utxo.output.plutusData;
          if (!utxoDatum) {
            throw new Error("No datum found in UTXO");
          }
          const decodedDatum = cbor.decode(Buffer.from(utxoDatum, "hex"));
          if (typeof decodedDatum.value[4] !== "number") {
            throw new Error("Invalid datum at position 4");
          }
          if (typeof decodedDatum.value[5] !== "number") {
            throw new Error("Invalid datum at position 5");
          }
          const redeemer = {
            data: {
              alternative: 3,
              fields: []
            }
          };
          const invalidBefore = unixTimeToEnclosingSlot(Date.now() - 15e4, SLOT_CONFIG_NETWORK[network]) - 1;
          const invalidAfter = unixTimeToEnclosingSlot(Date.now() + 15e4, SLOT_CONFIG_NETWORK[network]) + 1;
          const unsignedTx = new Transaction$1({ initiator: wallet }).redeemValue({
            value: utxo,
            script,
            redeemer
          }).setMetadata(674, {
            msg: ["Masumi", "RefundCollectionAfterTimeout"]
          }).sendAssets(
            {
              address
            },
            utxo.output.amount
          ).setChangeAddress(address).setRequiredSigners([address]);
          unsignedTx.txBuilder.invalidBefore(invalidBefore);
          unsignedTx.txBuilder.invalidHereafter(invalidAfter);
          const buildTransaction = await unsignedTx.build();
          const signedTx = await wallet.signTx(buildTransaction);
          const txHash = await wallet.submitTx(signedTx);
          await prisma.purchaseRequest.update({
            where: { id: request.id },
            data: { potentialTxHash: txHash, status: $Enums.PurchasingRequestStatus.RefundInitiated, SmartContractWallet: { update: { PendingTransaction: { update: { hash: txHash } } } } }
          });
          logger.info(`Created withdrawal transaction:
                  Tx ID: ${txHash}
                  View (after a bit) on https://${network === "preprod" ? "preprod." : ""}cardanoscan.io/transaction/${txHash}
                  Smart Contract Address: ${smartContractAddress}
              `);
        } catch (error) {
          logger.error(`Error creating refund transaction: ${error}`);
          if (request.errorRetries == null || request.errorRetries < networkCheck.maxRefundRetries) {
            await prisma.paymentRequest.update({
              where: { id: request.id },
              data: { errorRetries: { increment: 1 } }
            });
          } else {
            const errorMessage = "Error creating refund transaction: " + (error instanceof Error ? error.message : typeof error === "object" && error ? error.toString() : "Unknown Error");
            await prisma.paymentRequest.update({
              where: { id: request.id },
              data: {
                errorType: "UNKNOWN",
                errorRequiresManualReview: true,
                errorNote: errorMessage
              }
            });
          }
        }
      }));
    }));
  } finally {
    updateMutex.release();
  }
}

async function init() {
  logger.log({
    level: "info",
    message: "initialized cron events"
  });
  cron.schedule(CONFIG.CHECK_TX_INTERVAL, async () => {
    logger.info("updating cardano payment entries");
    const start = /* @__PURE__ */ new Date();
    await checkLatestTransactions();
    logger.info("finished updating cardano payment entries in " + ((/* @__PURE__ */ new Date()).getTime() - start.getTime()) / 1e3 + "s");
  });
  cron.schedule(CONFIG.BATCH_PAYMENT_INTERVAL, async () => {
    logger.info("batching payments");
    const start = /* @__PURE__ */ new Date();
    await batchLatestPaymentEntriesV1();
    logger.info("finished batching payments in " + ((/* @__PURE__ */ new Date()).getTime() - start.getTime()) / 1e3 + "s");
  });
  cron.schedule(CONFIG.CHECK_COLLECTION_INTERVAL, async () => {
    logger.info("checking for payments to collect");
    const start = /* @__PURE__ */ new Date();
    await collectOutstandingPaymentsV1();
    logger.info("finished checking payments to collect in " + ((/* @__PURE__ */ new Date()).getTime() - start.getTime()) / 1e3 + "s");
  });
  cron.schedule(CONFIG.CHECK_COLLECT_REFUND_INTERVAL, async () => {
    logger.info("checking for payments to collect and refund");
    const start = /* @__PURE__ */ new Date();
    await collectRefundV1();
    logger.info("finished checking payments to collect in " + ((/* @__PURE__ */ new Date()).getTime() - start.getTime()) / 1e3 + "s");
  });
  cron.schedule(CONFIG.CHECK_REFUND_INTERVAL, async () => {
    logger.info("checking for payments to refund");
    const start = /* @__PURE__ */ new Date();
    await collectRefundV1();
    await collectTimeoutRefundsV1();
    logger.info("finished checking payments to refund in " + ((/* @__PURE__ */ new Date()).getTime() - start.getTime()) / 1e3 + "s");
  });
  cron.schedule(CONFIG.CHECK_WALLET_TRANSACTION_HASH_INTERVAL, async () => {
    logger.info("checking for wallet transaction hash");
    const start = /* @__PURE__ */ new Date();
    await updateWalletTransactionHashHandlerService.updateWalletTransactionHash();
    logger.info("finished checking wallet transaction hash in " + ((/* @__PURE__ */ new Date()).getTime() - start.getTime()) / 1e3 + "s");
  });
}

function getHealthConfiguration$1() {
  return { "status": "ok" };
}
const healthRepository = { getHealthConfiguration: getHealthConfiguration$1 };

function getHealthConfiguration() {
  return healthRepository.getHealthConfiguration();
}
const healthService = { getHealthConfiguration };

const unauthenticatedEndpointFactory = defaultEndpointsFactory;

const healthResponseSchema = z.object({
  status: z.string()
});
const healthEndpointGet = unauthenticatedEndpointFactory.build({
  method: "get",
  input: z.object({}),
  output: healthResponseSchema,
  handler: async () => {
    const healthConfiguration = await healthService.getHealthConfiguration();
    return healthConfiguration;
  }
});

const authMiddleware = (minPermission) => new Middleware({
  security: {
    // this information is optional and used for generating documentation
    type: "header",
    name: "api-key"
  },
  input: z.object({}),
  handler: async ({ request, logger }) => {
    logger.info("Checking the key and token");
    const sendKey = request.headers.token;
    if (!sendKey) {
      throw createHttpError(401, "No token provided");
    }
    const apiKey = await prisma.apiKey.findUnique({
      where: {
        apiKey: sendKey
      }
    });
    if (!apiKey) {
      throw createHttpError(401, "Invalid token");
    }
    if (apiKey.status !== $Enums.ApiKeyStatus.ACTIVE) {
      throw createHttpError(401, "API key is revoked");
    }
    if (minPermission == $Enums.Permission.ADMIN && apiKey.permission != $Enums.Permission.ADMIN) {
      throw createHttpError(401, "Unauthorized, admin access required");
    }
    if (minPermission == $Enums.Permission.READ_PAY && (apiKey.permission != $Enums.Permission.READ_PAY && apiKey.permission != $Enums.Permission.ADMIN)) {
      throw createHttpError(401, "Unauthorized, payment access required");
    }
    return { id: apiKey.id, permissions: [apiKey.permission], usageLimited: apiKey.usageLimited };
  }
});

const adminAuthenticatedEndpointFactory = defaultEndpointsFactory.addMiddleware(authMiddleware("ADMIN"));

const getAPIKeySchemaInput = z.object({
  limit: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of API keys to return"),
  cursorApiKey: z.string().max(550).optional().describe("Used to paginate through the API keys")
});
const getAPIKeySchemaOutput = z.object({
  apiKeys: z.array(z.object({
    apiKey: z.string(),
    permission: z.nativeEnum(Permission),
    usageLimited: z.boolean(),
    RemainingUsageCredits: z.array(z.object({
      unit: z.string(),
      amount: z.number({ coerce: true }).int().min(0)
    })),
    status: z.nativeEnum(ApiKeyStatus)
  }))
});
const queryAPIKeyEndpointGet = adminAuthenticatedEndpointFactory.build({
  method: "get",
  input: getAPIKeySchemaInput,
  output: getAPIKeySchemaOutput,
  handler: async ({ input }) => {
    const result = await prisma.apiKey.findMany({ where: {}, cursor: input.cursorApiKey ? { apiKey: input.cursorApiKey } : void 0, take: input.limit, include: { RemainingUsageCredits: true } });
    return { apiKeys: result.map((data) => {
      return { ...data, RemainingUsageCredits: data.RemainingUsageCredits.map((usageCredit) => ({ unit: usageCredit.unit, amount: parseInt(usageCredit.amount.toString()) })) };
    }) };
  }
});
const addAPIKeySchemaInput = z.object({
  usageLimited: z.string().transform((s) => s.toLowerCase() == "true" ? true : false).default("true").describe("Whether the API key is usage limited. Meaning only allowed to use the specified credits or can freely spend"),
  UsageCredits: z.array(z.object({
    unit: z.string().max(150),
    amount: z.number({ coerce: true }).int().min(0).max(1e6)
  })).describe("The credits allowed to be used by the API key. Only relevant if usageLimited is true. "),
  permission: z.nativeEnum(Permission).default(Permission.READ).describe("The permission of the API key")
});
const addAPIKeySchemaOutput = z.object({
  id: z.string(),
  apiKey: z.string(),
  permission: z.nativeEnum(Permission),
  usageLimited: z.boolean(),
  status: z.nativeEnum(ApiKeyStatus)
});
const addAPIKeyEndpointPost = adminAuthenticatedEndpointFactory.build({
  method: "post",
  input: addAPIKeySchemaInput,
  output: addAPIKeySchemaOutput,
  handler: async ({ input }) => {
    const apiKey = ("masumi-registry-" + input.permission == $Enums.Permission.ADMIN ? "admin-" : "") + createId();
    const result = await prisma.apiKey.create({
      data: {
        apiKey,
        status: ApiKeyStatus.ACTIVE,
        permission: input.permission,
        usageLimited: input.usageLimited,
        RemainingUsageCredits: {
          createMany: { data: input.UsageCredits.map((usageCredit) => ({ unit: usageCredit.unit, amount: usageCredit.amount })) }
        }
      }
    });
    return result;
  }
});
const updateAPIKeySchemaInput = z.object({
  id: z.string().max(150).optional().describe("The id of the API key to update. Provide either id or apiKey"),
  apiKey: z.string().max(550).optional().describe("The API key to update. Provide either id or apiKey"),
  UsageCredits: z.array(z.object({
    unit: z.string().max(150),
    amount: z.number({ coerce: true }).int().min(0).max(1e6)
  })).optional().describe("The remaining credits allowed to be used by the API key. Only relevant if usageLimited is true. "),
  status: z.nativeEnum(ApiKeyStatus).default(ApiKeyStatus.ACTIVE).optional().describe("The status of the API key")
});
const updateAPIKeySchemaOutput = z.object({
  id: z.string(),
  apiKey: z.string(),
  permission: z.nativeEnum(Permission),
  usageLimited: z.boolean(),
  status: z.nativeEnum(ApiKeyStatus)
});
const updateAPIKeyEndpointPatch = adminAuthenticatedEndpointFactory.build({
  method: "patch",
  input: updateAPIKeySchemaInput,
  output: updateAPIKeySchemaOutput,
  handler: async ({ input }) => {
    if (input.id) {
      const result = await prisma.apiKey.update({ where: { id: input.id }, data: { usageLimited: input.usageLimited, status: input.status, RemainingUsageCredits: { set: input.UsageCredits?.map((usageCredit) => ({ id: createId(), unit: usageCredit.unit, amount: usageCredit.amount })) } } });
      return result;
    } else if (input.apiKey) {
      const result = await prisma.apiKey.update({ where: { apiKey: input.apiKey }, data: { usageLimited: input.usageLimited, status: input.status, RemainingUsageCredits: { set: input.UsageCredits?.map((usageCredit) => ({ id: createId(), unit: usageCredit.unit, amount: usageCredit.amount })) } } });
      return result;
    }
    throw createHttpError(400, "Invalid input");
  }
});
const deleteAPIKeySchemaInput = z.object({
  id: z.string().max(150).optional().describe("The id of the API key to delete. Provide either id or apiKey"),
  apiKey: z.string().max(550).optional().describe("The API key to delete. Provide either id or apiKey")
});
const deleteAPIKeySchemaOutput = z.object({
  id: z.string(),
  apiKey: z.string()
});
const deleteAPIKeyEndpointDelete = adminAuthenticatedEndpointFactory.build({
  method: "delete",
  input: deleteAPIKeySchemaInput,
  output: deleteAPIKeySchemaOutput,
  handler: async ({ input }) => {
    if (input.id) {
      const result = await prisma.apiKey.delete({ where: { id: input.id } });
      return result;
    } else if (input.apiKey) {
      const result = await prisma.apiKey.delete({ where: { apiKey: input.apiKey } });
      return result;
    }
    throw createHttpError(400, "Invalid input");
  }
});

const payAuthenticatedEndpointFactory = defaultEndpointsFactory.addMiddleware(authMiddleware("READ_PAY"));

class InsufficientFundsError extends Error {
  constructor(message) {
    super(message);
  }
}

async function handlePurchaseCreditInit$1(id, cost, network, identifier, paymentType, contractAddress, sellerVkey, submitResultTime, refundTime, unlockTime) {
  return await prisma.$transaction(async (transaction) => {
    const result = await transaction.apiKey.findUnique({
      where: { id },
      include: {
        RemainingUsageCredits: true
      }
    });
    if (!result) {
      throw Error("Invalid id: " + id);
    }
    const remainingAccumulatedUsageCredits = /* @__PURE__ */ new Map();
    result.RemainingUsageCredits.forEach((request) => {
      if (!remainingAccumulatedUsageCredits.has(request.unit)) {
        remainingAccumulatedUsageCredits.set(request.unit, 0n);
      }
      remainingAccumulatedUsageCredits.set(request.unit, remainingAccumulatedUsageCredits.get(request.unit) + request.amount);
    });
    const totalCost = /* @__PURE__ */ new Map();
    cost.forEach((amount) => {
      if (!totalCost.has(amount.unit)) {
        totalCost.set(amount.unit, 0n);
      }
      totalCost.set(amount.unit, totalCost.get(amount.unit) + amount.amount);
    });
    const newRemainingUsageCredits = remainingAccumulatedUsageCredits;
    if (result.usageLimited) {
      for (const [unit, amount] of totalCost) {
        if (!newRemainingUsageCredits.has(unit)) {
          throw new InsufficientFundsError("Credit unit not found: " + unit + " for id: " + id);
        }
        newRemainingUsageCredits.set(unit, newRemainingUsageCredits.get(unit) - amount);
        if (newRemainingUsageCredits.get(unit) < 0) {
          throw new InsufficientFundsError("Not enough " + unit + " tokens to handleCreditUsage for id: " + id);
        }
      }
    }
    const updatedUsageAmounts = Array.from(newRemainingUsageCredits.entries()).map(([unit, amount]) => ({
      id: `${id}-${unit}`,
      // Create a unique ID
      amount,
      unit
    }));
    if (result.usageLimited) {
      await transaction.apiKey.update({
        where: { id },
        data: {
          RemainingUsageCredits: {
            set: updatedUsageAmounts
          }
        }
      });
    }
    const networkHandler = await transaction.networkHandler.findUnique({
      where: {
        network_paymentContractAddress: { network, paymentContractAddress: contractAddress }
      }
    });
    if (!networkHandler) {
      throw Error("Invalid networkHandler: " + networkHandler);
    }
    const purchaseRequest = await prisma.purchaseRequest.create({
      data: {
        triggeredBy: { connect: { id } },
        Amounts: {
          create: Array.from(totalCost.entries()).map(([unit, amount]) => ({
            amount,
            unit
          }))
        },
        submitResultTime: submitResultTime.getTime(),
        NetworkHandler: { connect: { id: networkHandler.id } },
        SellerWallet: {
          connectOrCreate: {
            where: { networkHandlerId_walletVkey: { networkHandlerId: networkHandler.id, walletVkey: sellerVkey } },
            create: { walletVkey: sellerVkey, networkHandlerId: networkHandler.id }
          }
        },
        identifier,
        status: $Enums.PurchasingRequestStatus.PurchaseRequested,
        refundTime: refundTime.getTime(),
        unlockTime: unlockTime.getTime()
      }
    });
    return purchaseRequest;
  }, { isolationLevel: "ReadCommitted", maxWait: 15e3, timeout: 15e3 });
}
const creditTokenRepository = { handlePurchaseCreditInit: handlePurchaseCreditInit$1 };

async function handlePurchaseCreditInit(id, tokenCreditCost, network, identifier, paymentType, contractAddress, sellerVkey, submitResultTime, refundTime, unlockTime) {
  try {
    return await creditTokenRepository.handlePurchaseCreditInit(id, tokenCreditCost, network, identifier, paymentType, contractAddress, sellerVkey, submitResultTime, refundTime, unlockTime);
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      throw createHttpError(400, "Insufficient funds");
    }
    logger.error(error);
    throw createHttpError(500, "Error handling payment credit initialization");
  }
}
const tokenCreditService = { handlePurchaseCreditInit };

const queryPurchaseRequestSchemaInput = z.object({
  limit: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of purchases to return"),
  cursorIdentifierSellingWalletVkey: z.string().max(250).optional().describe("Used to paginate through the purchases. If this is provided, cursorIdentifier is required"),
  cursorIdentifier: z.string().max(250).optional().describe("Used to paginate through the purchases. If this is provided, cursorIdentifierSellingWalletVkey is required"),
  network: z.nativeEnum($Enums.Network).describe("The network the purchases were made on"),
  paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the purchases were made to")
});
const queryPurchaseRequestSchemaOutput = z.object({
  purchases: z.array(z.object({
    createdAt: z.date(),
    updatedAt: z.date(),
    status: z.nativeEnum($Enums.PurchasingRequestStatus),
    txHash: z.string().nullable(),
    utxo: z.string().nullable(),
    errorType: z.nativeEnum($Enums.PurchaseRequestErrorType).nullable(),
    errorNote: z.string().nullable(),
    errorRequiresManualReview: z.boolean().nullable(),
    identifier: z.string(),
    SmartContractWallet: z.object({ id: z.string(), walletAddress: z.string(), walletVkey: z.string(), note: z.string().nullable() }).nullable(),
    SellerWallet: z.object({ walletVkey: z.string(), note: z.string().nullable() }).nullable(),
    Amounts: z.array(z.object({ id: z.string(), createdAt: z.date(), updatedAt: z.date(), amount: z.number({ coerce: true }).min(0), unit: z.string() })),
    NetworkHandler: z.object({ id: z.string(), network: z.nativeEnum($Enums.Network), paymentContractAddress: z.string(), paymentType: z.nativeEnum($Enums.PaymentType) }).nullable()
  }))
});
const queryPurchaseRequestGet = payAuthenticatedEndpointFactory.build({
  method: "get",
  input: queryPurchaseRequestSchemaInput,
  output: queryPurchaseRequestSchemaOutput,
  handler: async ({ input, logger }) => {
    logger.info("Querying registry");
    const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const networkHandler = await prisma.networkHandler.findUnique({ where: { network_paymentContractAddress: { network: input.network, paymentContractAddress } } });
    if (networkHandler == null) {
      throw createHttpError(404, "Network handler not found");
    }
    let cursor = void 0;
    if (input.cursorIdentifierSellingWalletVkey && input.cursorIdentifier) {
      const sellerWallet = await prisma.sellerWallet.findUnique({ where: { networkHandlerId_walletVkey: { networkHandlerId: networkHandler.id, walletVkey: input.cursorIdentifierSellingWalletVkey } } });
      if (sellerWallet == null) {
        throw createHttpError(404, "Selling wallet not found");
      }
      cursor = { networkHandlerId_identifier_sellerWalletId: { networkHandlerId: networkHandler.id, identifier: input.cursorIdentifier, sellerWalletId: sellerWallet.id } };
    }
    const result = await prisma.purchaseRequest.findMany({
      where: { networkHandlerId: networkHandler.id },
      cursor,
      take: input.limit,
      include: {
        SellerWallet: { select: { walletVkey: true, note: true } },
        SmartContractWallet: { select: { id: true, walletVkey: true, note: true, walletAddress: true } },
        NetworkHandler: true,
        Amounts: true
      }
    });
    if (result == null) {
      throw createHttpError(404, "Purchase not found");
    }
    return { purchases: result.map((purchase) => ({ ...purchase, Amounts: purchase.Amounts.map((amount) => ({ ...amount, amount: Number(amount.amount) })) })) };
  }
});
const createPurchaseInitSchemaInput = z.object({
  identifier: z.string().max(250).describe("The identifier of the purchase. Is provided by the seller"),
  network: z.nativeEnum($Enums.Network).describe("The network the transaction will be made on"),
  sellerVkey: z.string().max(250).describe("The verification key of the seller"),
  paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the purchase will be made to"),
  amounts: z.array(z.object({ amount: z.number({ coerce: true }).min(0).max(Number.MAX_SAFE_INTEGER), unit: z.string() })).max(7).describe("The amounts of the purchase"),
  paymentType: z.nativeEnum($Enums.PaymentType).describe("The payment type of smart contract used"),
  unlockTime: ez.dateIn().describe("The time after which the purchase will be unlocked"),
  refundTime: ez.dateIn().describe("The time after which a refund will be approved"),
  submitResultTime: ez.dateIn().describe("The time by which the result has to be submitted")
});
const createPurchaseInitSchemaOutput = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  status: z.nativeEnum($Enums.PurchasingRequestStatus)
});
const createPurchaseInitPost = payAuthenticatedEndpointFactory.build({
  method: "post",
  input: createPurchaseInitSchemaInput,
  output: createPurchaseInitSchemaOutput,
  handler: async ({ input, options, logger }) => {
    logger.info("Creating purchase", input.paymentTypes);
    const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const networkCheckSupported = await prisma.networkHandler.findUnique({ where: { network_paymentContractAddress: { network: input.network, paymentContractAddress } } });
    if (networkCheckSupported == null) {
      throw createHttpError(404, "Network and Address combination not supported");
    }
    const wallets = await prisma.purchasingWallet.aggregate({ where: { networkHandlerId: networkCheckSupported.id }, _count: true });
    if (wallets._count === 0) {
      throw createHttpError(404, "No valid purchasing wallets found");
    }
    const additionalRefundTime = 1e3 * 60 * 60 * 3;
    if (input.unlockTime > new Date(input.refundTime.getTime() + additionalRefundTime)) {
      throw createHttpError(400, "Refund request time must be after unlock time with at least 3 hours difference");
    }
    if (input.submitResultTime.getTime() < Date.now()) {
      throw createHttpError(400, "Submit result time must be in the future");
    }
    const offset = 1e3 * 60 * 15;
    if (input.submitResultTime > new Date(input.unlockTime.getTime() + offset)) {
      throw createHttpError(400, "Submit result time must be after unlock time with at least 15 minutes difference");
    }
    const initial = await tokenCreditService.handlePurchaseCreditInit(options.id, input.amounts.map((amount) => ({ amount: BigInt(amount.amount), unit: amount.unit })), input.network, input.identifier, input.paymentType, paymentContractAddress, input.sellerVkey, input.submitResultTime, input.unlockTime, input.refundTime);
    return initial;
  }
});
const refundPurchaseSchemaInput = z.object({
  identifier: z.string().max(250).describe("The identifier of the purchase to be refunded"),
  network: z.nativeEnum($Enums.Network).describe("The network the Cardano wallet will be used on"),
  paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract holding the purchase")
});
const refundPurchaseSchemaOutput = z.object({
  txHash: z.string()
});
const refundPurchasePatch = payAuthenticatedEndpointFactory.build({
  method: "patch",
  input: refundPurchaseSchemaInput,
  output: refundPurchaseSchemaOutput,
  handler: async ({ input, logger }) => {
    logger.info("Creating purchase", input.paymentTypes);
    const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const networkCheckSupported = await prisma.networkHandler.findUnique({
      where: {
        network_paymentContractAddress: { network: input.network, paymentContractAddress }
      },
      include: {
        FeeReceiverNetworkWallet: true,
        AdminWallets: true,
        PurchaseRequests: {
          where: {
            identifier: input.identifier
          },
          include: {
            SellerWallet: true,
            SmartContractWallet: {
              include: { WalletSecret: true }
            }
          }
        }
      }
    });
    if (networkCheckSupported == null) {
      throw createHttpError(404, "Network and Address combination not supported");
    }
    if (networkCheckSupported.PurchaseRequests.length == 0) {
      throw createHttpError(404, "Purchase not found");
    }
    const purchase = networkCheckSupported.PurchaseRequests[0];
    if (purchase.status != $Enums.PurchasingRequestStatus.RefundConfirmed) {
      throw createHttpError(400, "Purchase in invalid state " + purchase.status);
    }
    const blockchainProvider = new BlockfrostProvider(
      networkCheckSupported.rpcProviderApiKey
    );
    const wallet = new MeshWallet({
      networkId: 0,
      fetcher: blockchainProvider,
      submitter: blockchainProvider,
      key: {
        type: "mnemonic",
        words: decrypt(purchase.SmartContractWallet.WalletSecret.secret).split(" ")
      }
    });
    const address = (await wallet.getUnusedAddresses())[0];
    const { script, smartContractAddress } = await getPaymentScriptFromNetworkHandlerV1(networkCheckSupported);
    const utxos = await wallet.getUtxos();
    if (utxos.length === 0) {
      throw new Error("No UTXOs found in the wallet. Wallet is empty.");
    }
    const utxoByHash = await blockchainProvider.fetchUTxOs(
      purchase.txHash
    );
    const utxo = utxoByHash.find((utxo2) => utxo2.input.txHash == purchase.txHash);
    if (!utxo) {
      throw new Error("UTXO not found");
    }
    if (!utxo) {
      throw new Error("UTXO not found");
    }
    const sellerVerificationKeyHash = purchase.SellerWallet.walletVkey;
    const buyerVerificationKeyHash = purchase.SmartContractWallet?.walletVkey;
    if (!buyerVerificationKeyHash)
      throw createHttpError(404, "purchasing wallet not found");
    const utxoDatum = utxo.output.plutusData;
    if (!utxoDatum) {
      throw new Error("No datum found in UTXO");
    }
    const decodedDatum = cbor.decode(Buffer.from(utxoDatum, "hex"));
    if (typeof decodedDatum.value[3] !== "string") {
      throw new Error("Invalid datum at position 3");
    }
    const resultHash = Buffer.from(decodedDatum.value[3], "hex").toString("utf-8");
    if (typeof decodedDatum.value[4] !== "number") {
      throw new Error("Invalid datum at position 4");
    }
    if (typeof decodedDatum.value[5] !== "number") {
      throw new Error("Invalid datum at position 5");
    }
    if (typeof decodedDatum.value[6] !== "number") {
      throw new Error("Invalid datum at position 5");
    }
    const submitResultTime = decodedDatum.value[4];
    const unlockTime = decodedDatum.value[5];
    const refundTime = decodedDatum.value[6];
    const refundDenied = cardanoTxHandlerService.mBoolToBool(decodedDatum.value[8]);
    if (refundDenied == null) {
      throw new Error("Invalid datum at position 8");
    }
    const datum = {
      value: {
        alternative: 0,
        fields: [
          buyerVerificationKeyHash,
          sellerVerificationKeyHash,
          purchase.identifier,
          resultHash,
          submitResultTime,
          unlockTime,
          refundTime,
          //is converted to true
          mBool(true),
          //is converted to false
          //Todo decode old contract value
          mBool(refundDenied)
        ]
      },
      inline: true
    };
    const redeemer = {
      data: {
        alternative: 2,
        fields: []
      }
    };
    const networkType = convertNetwork(networkCheckSupported.network);
    const invalidBefore = unixTimeToEnclosingSlot(Date.now() - 15e4, SLOT_CONFIG_NETWORK[networkType]) - 1;
    const invalidHereafter = unixTimeToEnclosingSlot(Date.now() + 15e4, SLOT_CONFIG_NETWORK[networkType]) + 1;
    const unsignedTx = new Transaction$1({ initiator: wallet }).setMetadata(674, {
      msg: ["Masumi", "RequestRefund"]
    }).redeemValue({
      value: utxo,
      script,
      redeemer
    }).sendValue(
      { address: smartContractAddress, datum },
      utxo
    ).setChangeAddress(address).setRequiredSigners([address]);
    unsignedTx.txBuilder.invalidBefore(invalidBefore);
    unsignedTx.txBuilder.invalidHereafter(invalidHereafter);
    const buildTransaction = await unsignedTx.build();
    const signedTx = await wallet.signTx(buildTransaction);
    const txHash = await wallet.submitTx(signedTx);
    await prisma.purchaseRequest.update({ where: { id: purchase.id }, data: { status: $Enums.PurchasingRequestStatus.RefundRequestInitiated, potentialTxHash: txHash } });
    return { txHash };
  }
});

const authenticatedEndpointFactory = defaultEndpointsFactory.addMiddleware(authMiddleware("READ"));

const queryPaymentsSchemaInput = z.object({
  limit: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of payments to return"),
  cursorIdentifier: z.string().max(250).optional().describe("Used to paginate through the payments"),
  network: z.nativeEnum($Enums.Network).describe("The network the payments were made on"),
  paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the payments were made to")
});
const queryPaymentsSchemaOutput = z.object({
  payments: z.array(z.object({
    createdAt: z.date(),
    updatedAt: z.date(),
    status: z.nativeEnum($Enums.PaymentRequestStatus),
    txHash: z.string().nullable(),
    utxo: z.string().nullable(),
    errorType: z.nativeEnum($Enums.PaymentRequestErrorType).nullable(),
    errorNote: z.string().nullable(),
    errorRequiresManualReview: z.boolean().nullable(),
    identifier: z.string(),
    SmartContractWallet: z.object({ id: z.string(), walletAddress: z.string(), walletVkey: z.string(), note: z.string().nullable() }).nullable(),
    BuyerWallet: z.object({ walletVkey: z.string() }).nullable(),
    Amounts: z.array(z.object({ id: z.string(), createdAt: z.date(), updatedAt: z.date(), amount: z.number({ coerce: true }).min(0), unit: z.string() })),
    NetworkHandler: z.object({ id: z.string(), network: z.nativeEnum($Enums.Network), paymentContractAddress: z.string(), paymentType: z.nativeEnum($Enums.PaymentType) })
  }))
});
const queryPaymentEntryGet = authenticatedEndpointFactory.build({
  method: "get",
  input: queryPaymentsSchemaInput,
  output: queryPaymentsSchemaOutput,
  handler: async ({ input, logger }) => {
    logger.info("Querying db");
    const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const networkHandler = await prisma.networkHandler.findUnique({
      where: {
        network_paymentContractAddress: {
          network: input.network,
          paymentContractAddress
        }
      },
      include: { SellingWallets: true, CollectionWallet: true }
    });
    if (!networkHandler) {
      throw createHttpError(404, "Network handler not found");
    }
    const result = await prisma.paymentRequest.findMany({
      where: { networkHandlerId: networkHandler.id },
      orderBy: { createdAt: "desc" },
      cursor: input.cursorIdentifier ? {
        networkHandlerId_identifier: {
          networkHandlerId: networkHandler.id,
          identifier: input.cursorIdentifier
        }
      } : void 0,
      take: input.limit,
      include: {
        BuyerWallet: true,
        SmartContractWallet: true,
        NetworkHandler: true,
        Amounts: true
      }
    });
    if (result == null) {
      throw createHttpError(404, "Payment not found");
    }
    return { payments: result.map((payment) => ({ ...payment, Amounts: payment.Amounts.map((amount) => ({ ...amount, amount: Number(amount.amount) })) })) };
  }
});
const createPaymentsSchemaInput = z.object({
  network: z.nativeEnum($Enums.Network).describe("The network the payment will be received on"),
  agentIdentifier: z.string().min(15).max(250).describe("The identifier of the agent that will be paid"),
  amounts: z.array(z.object({ amount: z.number({ coerce: true }).min(0).max(Number.MAX_SAFE_INTEGER), unit: z.string() })).max(7).describe("The amounts of the payment"),
  paymentType: z.nativeEnum($Enums.PaymentType).describe("The type of payment contract used"),
  paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the payment will be made to"),
  submitResultTime: ez.dateIn().default(new Date(Date.now() + 1e3 * 60 * 60 * 12).toISOString()).describe("The time after which the payment has to be submitted to the smart contract"),
  unlockTime: ez.dateIn().optional().describe("The time after which the payment will be unlocked"),
  refundTime: ez.dateIn().optional().describe("The time after which a refund will be approved")
});
const createPaymentSchemaOutput = z.object({
  createdAt: z.date(),
  updatedAt: z.date(),
  status: z.nativeEnum($Enums.PaymentRequestStatus),
  txHash: z.string().nullable(),
  utxo: z.string().nullable(),
  errorType: z.nativeEnum($Enums.PaymentRequestErrorType).nullable(),
  errorNote: z.string().nullable(),
  errorRequiresManualReview: z.boolean().nullable(),
  identifier: z.string(),
  Amounts: z.array(z.object({ id: z.string(), createdAt: z.date(), updatedAt: z.date(), amount: z.number({ coerce: true }).min(0), unit: z.string() })),
  SmartContractWallet: z.object({ id: z.string(), walletAddress: z.string(), walletVkey: z.string(), note: z.string().nullable() }),
  BuyerWallet: z.object({ walletVkey: z.string() }).nullable(),
  NetworkHandler: z.object({ id: z.string(), network: z.nativeEnum($Enums.Network), paymentContractAddress: z.string(), paymentType: z.nativeEnum($Enums.PaymentType) })
});
const paymentInitPost = authenticatedEndpointFactory.build({
  method: "post",
  input: createPaymentsSchemaInput,
  output: createPaymentSchemaOutput,
  handler: async ({ input, logger }) => {
    logger.info("Creating purchase", input.paymentTypes);
    const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const networkCheckSupported = await prisma.networkHandler.findUnique({
      where: {
        network_paymentContractAddress: {
          network: input.network,
          paymentContractAddress
        }
      },
      include: { SellingWallets: true, CollectionWallet: true }
    });
    if (networkCheckSupported == null) {
      throw createHttpError(404, "Network and Address combination not supported");
    }
    const unlockTime = input.unlockTime != void 0 ? input.unlockTime.getTime() : new Date(Date.now() + 1e3 * 60 * 60 * 12).getTime();
    const refundTime = input.refundTime != void 0 ? input.refundTime.getTime() : new Date(Date.now() + 1e3 * 60 * 60 * 24).getTime();
    const provider = new BlockFrostAPI({
      projectId: networkCheckSupported.rpcProviderApiKey
    });
    const { policyId } = await getRegistryScriptV1(paymentContractAddress, input.network);
    const assetInWallet = await provider.assetsAddresses(policyId + input.agentIdentifier, { order: "desc", count: 1 });
    if (assetInWallet.length == 0) {
      throw createHttpError(404, "Agent identifier not found");
    }
    const vKey = resolvePaymentKeyHash(assetInWallet[0].address);
    const sellingWallet = networkCheckSupported.SellingWallets.find((wallet) => wallet.walletVkey == vKey);
    if (sellingWallet == null) {
      throw createHttpError(404, "Agent identifier not found in wallet");
    }
    const payment = await prisma.paymentRequest.create({
      data: {
        identifier: input.agentIdentifier + "_" + cuid2.createId(),
        NetworkHandler: { connect: { id: networkCheckSupported.id } },
        Amounts: { createMany: { data: input.amounts.map((amount) => ({ amount: amount.amount, unit: amount.unit })) } },
        status: $Enums.PaymentRequestStatus.PaymentRequested,
        submitResultTime: input.submitResultTime.getTime(),
        SmartContractWallet: { connect: { id: sellingWallet.id } },
        unlockTime,
        refundTime
      },
      include: { Amounts: true, BuyerWallet: true, SmartContractWallet: true, NetworkHandler: true }
    });
    if (payment.SmartContractWallet == null) {
      throw createHttpError(500, "Smart contract wallet not connected");
    }
    return { ...payment, SmartContractWallet: payment.SmartContractWallet, Amounts: payment.Amounts.map((amount) => ({ ...amount, amount: Number(amount.amount) })) };
  }
});
const updatePaymentsSchemaInput = z.object({
  network: z.nativeEnum($Enums.Network).describe("The network the payment was received on"),
  paymentContractAddress: z.string().max(250).optional().describe("The address of the smart contract where the payment was made to"),
  hash: z.string().max(250).describe("The hash of the AI agent result to be submitted"),
  identifier: z.string().max(250).describe("The identifier of the payment")
});
const updatePaymentSchemaOutput = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  status: z.nativeEnum($Enums.PaymentRequestStatus)
});
const paymentUpdatePatch = authenticatedEndpointFactory.build({
  method: "patch",
  input: updatePaymentsSchemaInput,
  output: updatePaymentSchemaOutput,
  handler: async ({ input, logger }) => {
    logger.info("Creating purchase", input.paymentTypes);
    const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const networkCheckSupported = await prisma.networkHandler.findUnique({
      where: {
        network_paymentContractAddress: {
          network: input.network,
          paymentContractAddress
        }
      },
      include: { SellingWallets: true, CollectionWallet: true, PaymentRequests: { where: { identifier: input.identifier } } }
    });
    if (networkCheckSupported == null) {
      throw createHttpError(404, "Network and Address combination not supported");
    }
    if (networkCheckSupported.PaymentRequests.length == 0) {
      throw createHttpError(404, "Payment not found");
    }
    if (networkCheckSupported.PaymentRequests[0].status != $Enums.PaymentRequestStatus.PaymentConfirmed) {
      throw createHttpError(400, "Payment in invalid state " + networkCheckSupported.PaymentRequests[0].status);
    }
    const payment = await prisma.paymentRequest.update({
      where: { id: networkCheckSupported.PaymentRequests[0].id },
      data: {
        resultHash: input.hash
      }
    });
    return payment;
  }
});

const metadataStringConvert = (value) => value == void 0 ? void 0 : typeof value === "string" ? value : value.join("");

const metadataSchema = z.object({
  name: z.string().min(1).or(z.array(z.string().min(1))),
  description: z.string().or(z.array(z.string())).optional(),
  api_url: z.string().min(1).url().or(z.array(z.string().min(1))),
  example_output: z.string().or(z.array(z.string())).optional(),
  capability: z.object({
    name: z.string().or(z.array(z.string())),
    version: z.string().or(z.array(z.string()))
  }),
  requests_per_hour: z.string().or(z.array(z.string())).optional(),
  author: z.object({
    name: z.string().min(1).or(z.array(z.string().min(1))),
    contact: z.string().or(z.array(z.string())).optional(),
    organization: z.string().or(z.array(z.string())).optional()
  }),
  legal: z.object({
    privacy_policy: z.string().or(z.array(z.string())).optional(),
    terms: z.string().or(z.array(z.string())).optional(),
    other: z.string().or(z.array(z.string())).optional()
  }).optional(),
  tags: z.array(z.string().min(1)).min(1),
  pricing: z.array(z.object({
    quantity: z.number({ coerce: true }).int().min(1),
    unit: z.string().min(1).or(z.array(z.string().min(1)))
  })).min(1),
  image: z.string().or(z.array(z.string())),
  metadata_version: z.number({ coerce: true }).int().min(1).max(1)
});
const queryAgentSchemaInput = z.object({
  walletVKey: z.string().max(250).describe("The payment key of the wallet to be queried"),
  network: z.nativeEnum($Enums.Network).describe("The Cardano network used to register the agent on"),
  paymentContractAddress: z.string().max(250).optional().describe("The smart contract address of the payment contract to which the registration belongs")
});
const queryAgentSchemaOutput = z.object({
  assets: z.array(z.object({
    unit: z.string().max(250),
    metadata: z.object({
      name: z.string().max(250),
      description: z.string().max(250).nullable().optional(),
      api_url: z.string().max(250),
      example_output: z.string().max(250).nullable().optional(),
      tags: z.array(z.string().max(250)),
      requests_per_hour: z.string().max(250).nullable().optional(),
      capability: z.object({
        name: z.string().max(250),
        version: z.string().max(250)
      }),
      author: z.object({
        name: z.string().max(250),
        contact: z.string().max(250).nullable().optional(),
        organization: z.string().max(250).nullable().optional()
      }),
      legal: z.object({
        privacy_policy: z.string().max(250).nullable().optional(),
        terms: z.string().max(250).nullable().optional(),
        other: z.string().max(250).nullable().optional()
      }).nullable().optional(),
      pricing: z.array(z.object({
        quantity: z.number({ coerce: true }).int().min(1),
        unit: z.string().max(250)
      })).min(1),
      image: z.string().max(250),
      metadata_version: z.number({ coerce: true }).int().min(1).max(1)
    })
  }))
});
const queryAgentGet = payAuthenticatedEndpointFactory.build({
  method: "get",
  input: queryAgentSchemaInput,
  output: queryAgentSchemaOutput,
  handler: async ({ input }) => {
    const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const networkCheckSupported = await prisma.networkHandler.findUnique({ where: { network_paymentContractAddress: { network: input.network, paymentContractAddress } }, include: { AdminWallets: true, SellingWallets: { include: { WalletSecret: true } } } });
    if (networkCheckSupported == null) {
      throw createHttpError(404, "Network and Address combination not supported");
    }
    const blockfrost = new BlockFrostAPI({
      projectId: networkCheckSupported.rpcProviderApiKey
    });
    const wallet = networkCheckSupported.SellingWallets.find((wallet2) => wallet2.walletVkey == input.walletVKey);
    if (wallet == null) {
      throw createHttpError(404, "Wallet not found");
    }
    const { policyId } = await getRegistryScriptFromNetworkHandlerV1(networkCheckSupported);
    const addressInfo = await blockfrost.addresses(wallet.walletAddress);
    if (addressInfo.stake_address == null) {
      throw createHttpError(404, "Stake address not found");
    }
    const stakeAddress = addressInfo.stake_address;
    const holderWallet = await blockfrost.accountsAddressesAssetsAll(stakeAddress);
    if (!holderWallet || holderWallet.length == 0) {
      throw createHttpError(404, "Asset not found");
    }
    const assets = holderWallet.filter((asset) => asset.unit.startsWith(policyId));
    const detailedAssets = [];
    await Promise.all(assets.map(async (asset) => {
      const assetInfo = await blockfrost.assetsById(asset.unit);
      const parsedMetadata = metadataSchema.safeParse(assetInfo.onchain_metadata);
      if (!parsedMetadata.success) {
        return;
      }
      detailedAssets.push({
        unit: asset.unit,
        metadata: {
          name: metadataStringConvert(parsedMetadata.data.name),
          description: metadataStringConvert(parsedMetadata.data.description),
          api_url: metadataStringConvert(parsedMetadata.data.api_url),
          example_output: metadataStringConvert(parsedMetadata.data.example_output),
          capability: {
            name: metadataStringConvert(parsedMetadata.data.capability.name),
            version: metadataStringConvert(parsedMetadata.data.capability.version)
          },
          author: {
            name: metadataStringConvert(parsedMetadata.data.author.name),
            contact: metadataStringConvert(parsedMetadata.data.author.contact),
            organization: metadataStringConvert(parsedMetadata.data.author.organization)
          },
          legal: parsedMetadata.data.legal ? {
            privacy_policy: metadataStringConvert(parsedMetadata.data.legal.privacy_policy),
            terms: metadataStringConvert(parsedMetadata.data.legal.terms),
            other: metadataStringConvert(parsedMetadata.data.legal.other)
          } : void 0,
          tags: parsedMetadata.data.tags.map((tag) => metadataStringConvert(tag)),
          pricing: parsedMetadata.data.pricing.map((price) => ({
            quantity: price.quantity,
            unit: metadataStringConvert(price.unit)
          })),
          image: metadataStringConvert(parsedMetadata.data.image),
          metadata_version: parsedMetadata.data.metadata_version
        }
      });
    }));
    return { assets: detailedAssets };
  }
});
const registerAgentSchemaInput = z.object({
  network: z.nativeEnum($Enums.Network).describe("The Cardano network used to register the agent on"),
  paymentContractAddress: z.string().max(250).optional().describe("The smart contract address of the payment contract to be registered for"),
  sellingWalletVkey: z.string().max(250).optional().describe("The payment key of a specific wallet used for the registration"),
  tags: z.array(z.string().max(63)).min(1).max(15).describe("Tags used in the registry metadata"),
  name: z.string().max(250).describe("Name of the agent"),
  api_url: z.string().max(250).describe("Base URL of the agent, to request interactions"),
  description: z.string().max(250).describe("Description of the agent"),
  capability: z.object({ name: z.string().max(250), version: z.string().max(250) }).describe("Provide information about the used AI model and version"),
  requests_per_hour: z.string().max(250).describe("The request the agent can handle per hour"),
  pricing: z.array(z.object({
    unit: z.string().max(250),
    quantity: z.string().max(55)
  })).max(5).describe("Price for a default interaction"),
  legal: z.object({
    privacy_policy: z.string().max(250).optional(),
    terms: z.string().max(250).optional(),
    other: z.string().max(250).optional()
  }).optional().describe("Legal information about the agent"),
  author: z.object({
    name: z.string().max(250),
    contact: z.string().max(250).optional(),
    organization: z.string().max(250).optional()
  }).describe("Author information about the agent")
});
const registerAgentSchemaOutput = z.object({
  txHash: z.string()
});
const registerAgentPost = payAuthenticatedEndpointFactory.build({
  method: "post",
  input: registerAgentSchemaInput,
  output: registerAgentSchemaOutput,
  handler: async ({ input, logger }) => {
    logger.info("Registering Agent", input.paymentTypes);
    const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const networkCheckSupported = await prisma.networkHandler.findUnique({
      where: {
        network_paymentContractAddress: {
          network: input.network,
          paymentContractAddress
        }
      },
      include: { AdminWallets: true, SellingWallets: { include: { WalletSecret: true } } }
    });
    if (networkCheckSupported == null) {
      throw createHttpError(404, "Network and Address combination not supported");
    }
    if (networkCheckSupported.SellingWallets == null || networkCheckSupported.SellingWallets.length == 0) {
      throw createHttpError(404, "No Selling Wallets found");
    }
    const blockchainProvider = new BlockfrostProvider(
      networkCheckSupported.rpcProviderApiKey
    );
    let sellingWallet = networkCheckSupported.SellingWallets.find((wallet2) => wallet2.walletVkey == input.sellingWalletVkey);
    if (sellingWallet == null) {
      if (input.sellingWalletVkey != null) {
        throw createHttpError(404, "Selling Wallet not found");
      }
      const randomIndex = Math.floor(Math.random() * networkCheckSupported.SellingWallets.length);
      sellingWallet = networkCheckSupported.SellingWallets[randomIndex];
    }
    const wallet = new MeshWallet({
      networkId: 0,
      fetcher: blockchainProvider,
      submitter: blockchainProvider,
      key: {
        type: "mnemonic",
        words: decrypt(sellingWallet.WalletSecret.secret).split(" ")
      }
    });
    const address = (await wallet.getUnusedAddresses())[0];
    const { script, policyId, smartContractAddress } = await getRegistryScriptFromNetworkHandlerV1(networkCheckSupported);
    const utxos = await wallet.getUtxos();
    if (utxos.length === 0) {
      throw new Error("No UTXOs found for the wallet");
    }
    const firstUtxo = utxos[0];
    const txId = firstUtxo.input.txHash;
    const txIndex = firstUtxo.input.outputIndex;
    const serializedOutput = txId + txIndex.toString(16).padStart(8, "0");
    const serializedOutputUint8Array = new Uint8Array(
      Buffer.from(serializedOutput.toString(), "hex")
    );
    const blake2b256 = blake2b(serializedOutputUint8Array, 32);
    const assetName = Buffer.from(blake2b256).toString("hex");
    const redeemer = {
      data: { alternative: 0, fields: [] },
      tag: "MINT"
    };
    const tx = new Transaction$1({ initiator: wallet }).setMetadata(674, {
      msg: ["Masumi", "RegisterAgent"]
    }).setTxInputs([
      //ensure our first utxo hash (serializedOutput) is used as first input
      firstUtxo,
      ...utxos.slice(1)
    ]);
    tx.isCollateralNeeded = true;
    tx.txBuilder.mintPlutusScript(script.version).mint("1", policyId, assetName).mintingScript(script.code).mintRedeemerValue(redeemer.data, "Mesh");
    tx.setMetadata(721, {
      [policyId]: {
        [assetName]: {
          name: stringToMetadata(input.name),
          description: stringToMetadata(input.description),
          api_url: stringToMetadata(input.api_url),
          example_output: stringToMetadata(input.example_output),
          capability: input.capability ? {
            name: stringToMetadata(input.capability.name),
            version: stringToMetadata(input.capability.version)
          } : void 0,
          requests_per_hour: stringToMetadata(input.requests_per_hour),
          author: {
            name: stringToMetadata(input.author.name),
            contact: input.author.contact ? stringToMetadata(input.author.contact) : void 0,
            organization: input.author.organization ? stringToMetadata(input.author.organization) : void 0
          },
          legal: input.legal ? {
            privacy_policy: input.legal?.privacy_policy ? stringToMetadata(input.legal.privacy_policy) : void 0,
            terms: input.legal?.terms ? stringToMetadata(input.legal.terms) : void 0,
            other: input.legal?.other ? stringToMetadata(input.legal.other) : void 0
          } : void 0,
          tags: input.tags,
          pricing: input.pricing.map((pricing) => ({
            unit: stringToMetadata(pricing.unit),
            quantity: pricing.quantity
          })),
          image: "ipfs://QmXXW7tmBgpQpXoJMAMEXXFe9dyQcrLFKGuzxnHDnbKC7f",
          metadata_version: "1"
        }
      }
    });
    tx.sendAssets(address, [{ unit: policyId + assetName, quantity: "1" }]);
    tx.sendLovelace(address, "5000000");
    tx.setChangeAddress(address).setRequiredSigners([address]);
    const unsignedTx = await tx.build();
    const signedTx = await wallet.signTx(unsignedTx, true);
    try {
      const txHash = await wallet.submitTx(signedTx);
      logger.info(`Minted 1 asset with the contract at:
            Tx ID: ${txHash}
            AssetName: ${assetName}
            PolicyId: ${policyId}
            AssetId: ${policyId + assetName}
            Smart Contract Address: ${smartContractAddress}
        `);
      return { txHash };
    } catch (error) {
      if (extractErrorMessage(error).includes("ValueNotConservedUTxO")) {
        throw createHttpError(429, "Too many requests");
      }
      throw createHttpError(500, "Failed to register agent");
    }
  }
});
function extractErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function stringToMetadata(s) {
  if (s == void 0) {
    return void 0;
  }
  const arr = [];
  for (let i = 0; i < s.length; i += 50) {
    arr.push(s.slice(i, i + 50));
  }
  return arr;
}
const unregisterAgentSchemaInput = z.object({
  assetName: z.string().max(250).describe("The identifier of the registration (asset) to be deregistered"),
  network: z.nativeEnum($Enums.Network).describe("The network the registration was made on"),
  paymentContractAddress: z.string().max(250).optional().describe("The smart contract address of the payment contract to which the registration belongs")
});
const unregisterAgentSchemaOutput = z.object({
  txHash: z.string()
});
const unregisterAgentDelete = payAuthenticatedEndpointFactory.build({
  method: "delete",
  input: unregisterAgentSchemaInput,
  output: unregisterAgentSchemaOutput,
  handler: async ({ input, logger }) => {
    logger.info("Deregister Agent", input.paymentTypes);
    const paymentContractAddress = input.paymentContractAddress ?? (input.network == $Enums.Network.MAINNET ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const networkCheckSupported = await prisma.networkHandler.findUnique({ where: { network_paymentContractAddress: { network: input.network, paymentContractAddress } }, include: { AdminWallets: true, SellingWallets: { include: { WalletSecret: true } } } });
    if (networkCheckSupported == null) {
      throw createHttpError(404, "Network and Address combination not supported");
    }
    if (networkCheckSupported.SellingWallets == null || networkCheckSupported.SellingWallets.length == 0) {
      throw createHttpError(404, "Selling Wallet not found");
    }
    const blockchainProvider = new BlockfrostProvider(
      networkCheckSupported.rpcProviderApiKey
    );
    const blockfrost = new BlockFrostAPI({
      projectId: networkCheckSupported.rpcProviderApiKey
    });
    const { policyId, script, smartContractAddress } = await getRegistryScriptFromNetworkHandlerV1(networkCheckSupported);
    let assetName = input.assetName;
    if (assetName.startsWith(policyId)) {
      assetName = assetName.slice(policyId.length);
    }
    const holderWallet = await blockfrost.assetsAddresses(policyId + assetName, { order: "desc", count: 1 });
    if (holderWallet.length == 0) {
      throw createHttpError(404, "Asset not found");
    }
    const vkey = resolvePaymentKeyHash$1(holderWallet[0].address);
    const sellingWallet = networkCheckSupported.SellingWallets.find((wallet2) => wallet2.walletVkey == vkey);
    if (sellingWallet == null) {
      throw createHttpError(404, "Registered Wallet not found");
    }
    const wallet = new MeshWallet({
      networkId: 0,
      fetcher: blockchainProvider,
      submitter: blockchainProvider,
      key: {
        type: "mnemonic",
        words: decrypt(sellingWallet.WalletSecret.secret).split(" ")
      }
    });
    const address = (await wallet.getUnusedAddresses())[0];
    const utxos = await wallet.getUtxos();
    if (utxos.length === 0) {
      throw new Error("No UTXOs found for the wallet");
    }
    const redeemer = {
      data: { alternative: 1, fields: [] }
    };
    const tx = new Transaction$1({ initiator: wallet }).setMetadata(674, {
      msg: ["Masumi", "DeregisterAgent"]
    }).setTxInputs(utxos);
    tx.isCollateralNeeded = true;
    tx.txBuilder.mintPlutusScript(script.version).mint("-1", policyId, assetName).mintingScript(script.code).mintRedeemerValue(redeemer.data, "Mesh");
    tx.sendLovelace(address, "5000000");
    tx.setChangeAddress(address).setRequiredSigners([address]);
    const unsignedTx = await tx.build();
    const signedTx = await wallet.signTx(unsignedTx, true);
    const txHash = await wallet.submitTx(signedTx);
    console.log(`Burned 1 asset with the contract at:
    Tx ID: ${txHash}
    AssetName: ${assetName}
    PolicyId: ${policyId}
    Smart Contract Address: ${smartContractAddress}
`);
    return { txHash };
  }
});

const paymentSourceSchemaInput = z.object({
  take: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of payment sources to return"),
  cursorId: z.string().max(250).optional().describe("Used to paginate through the payment sources")
});
const paymentSourceSchemaOutput = z.object({
  paymentSources: z.array(z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    network: z.nativeEnum($Enums.Network),
    paymentContractAddress: z.string(),
    paymentType: z.nativeEnum($Enums.PaymentType),
    rpcProviderApiKey: z.string(),
    lastIdentifierChecked: z.string().nullable(),
    isSyncing: z.boolean(),
    lastPageChecked: z.number(),
    lastCheckedAt: z.date().nullable(),
    AdminWallets: z.array(z.object({
      walletAddress: z.string(),
      order: z.number()
    })),
    CollectionWallet: z.object({
      id: z.string(),
      walletAddress: z.string(),
      note: z.string().nullable()
    }).nullable(),
    PurchasingWallets: z.array(z.object({
      id: z.string(),
      walletVkey: z.string(),
      walletAddress: z.string(),
      note: z.string().nullable()
    })),
    SellingWallets: z.array(z.object({
      id: z.string(),
      walletVkey: z.string(),
      walletAddress: z.string(),
      note: z.string().nullable()
    })),
    FeeReceiverNetworkWallet: z.object({
      walletAddress: z.string()
    }),
    feePermille: z.number().min(0).max(1e3)
  }))
});
const paymentSourceEndpointGet = adminAuthenticatedEndpointFactory.build({
  method: "get",
  input: paymentSourceSchemaInput,
  output: paymentSourceSchemaOutput,
  handler: async ({ input }) => {
    const paymentSources = await prisma.networkHandler.findMany({
      take: input.take,
      orderBy: {
        createdAt: "desc"
      },
      cursor: input.cursorId ? { id: input.cursorId } : void 0,
      include: {
        AdminWallets: { orderBy: { order: "asc" } },
        CollectionWallet: true,
        PurchasingWallets: true,
        SellingWallets: true,
        FeeReceiverNetworkWallet: true
      }
    });
    return { paymentSources };
  }
});
const paymentSourceCreateSchemaInput = z.object({
  network: z.nativeEnum($Enums.Network).describe("The network the payment source will be used on"),
  paymentType: z.nativeEnum($Enums.PaymentType).describe("The type of payment contract used"),
  rpcProviderApiKey: z.string().max(250).describe("The rpc provider (blockfrost) api key to be used for the payment source"),
  feePermille: z.number({ coerce: true }).min(0).max(1e3).describe("The fee in permille to be used for the payment source. The default contract uses 50 (5%)"),
  AdminWallets: z.array(z.object({
    walletAddress: z.string().max(250)
  })).min(3).max(3).describe("The wallet addresses of the admin wallets (exactly 3)"),
  FeeReceiverNetworkWallet: z.object({
    walletAddress: z.string().max(250)
  }).describe("The wallet address of the network fee receiver wallet"),
  CollectionWallet: z.object({
    walletAddress: z.string().max(250),
    note: z.string().max(250)
  }).describe("The wallet address and note of the collection wallet (ideally a hardware wallet). Please backup the mnemonic of the wallet."),
  PurchasingWallets: z.array(z.object({
    walletMnemonic: z.string().max(1500),
    note: z.string().max(250)
  })).min(1).max(50).describe("The mnemonic of the purchasing wallets to be added. Please backup the mnemonic of the wallets."),
  SellingWallets: z.array(z.object({
    walletMnemonic: z.string().max(1500),
    note: z.string().max(250)
  })).min(1).max(50).describe("The mnemonic of the selling wallets to be added. Please backup the mnemonic of the wallets.")
});
const paymentSourceCreateSchemaOutput = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  network: z.nativeEnum($Enums.Network),
  paymentContractAddress: z.string(),
  paymentType: z.nativeEnum($Enums.PaymentType),
  rpcProviderApiKey: z.string(),
  isSyncing: z.boolean(),
  lastIdentifierChecked: z.string().nullable(),
  lastPageChecked: z.number(),
  lastCheckedAt: z.date().nullable()
});
const paymentSourceEndpointPost = adminAuthenticatedEndpointFactory.build({
  method: "post",
  input: paymentSourceCreateSchemaInput,
  output: paymentSourceCreateSchemaOutput,
  handler: async ({ input }) => {
    const sellingWalletsMesh = input.SellingWallets.map((sellingWallet) => {
      return {
        wallet: new MeshWallet({
          networkId: input.network === "PREPROD" ? 0 : 1,
          key: {
            type: "mnemonic",
            words: sellingWallet.walletMnemonic.split(" ")
          }
        }),
        note: sellingWallet.note,
        secret: encrypt(sellingWallet.walletMnemonic)
      };
    });
    const purchasingWalletsMesh = input.PurchasingWallets.map((purchasingWallet) => {
      return {
        wallet: new MeshWallet({
          networkId: input.network === "PREPROD" ? 0 : 1,
          key: {
            type: "mnemonic",
            words: purchasingWallet.walletMnemonic.split(" ")
          }
        }),
        note: purchasingWallet.note,
        secret: encrypt(purchasingWallet.walletMnemonic)
      };
    });
    return await prisma.$transaction(async (prisma2) => {
      const { smartContractAddress } = await getPaymentScriptV1(input.AdminWallets[0].walletAddress, input.AdminWallets[1].walletAddress, input.AdminWallets[2].walletAddress, input.FeeReceiverNetworkWallet.walletAddress, input.FeePermille, input.network);
      const sellingWallets = await Promise.all(sellingWalletsMesh.map(async (sw) => {
        return {
          walletAddress: (await sw.wallet.getUnusedAddresses())[0],
          walletVkey: resolvePaymentKeyHash$1((await sw.wallet.getUnusedAddresses())[0]),
          walletSecretId: (await prisma2.walletSecret.create({ data: { secret: sw.secret } })).id,
          note: sw.note
        };
      }));
      const purchasingWallets = await Promise.all(purchasingWalletsMesh.map(async (pw) => {
        return {
          walletVkey: resolvePaymentKeyHash$1((await pw.wallet.getUnusedAddresses())[0]),
          walletAddress: (await pw.wallet.getUnusedAddresses())[0],
          walletSecretId: (await prisma2.walletSecret.create({ data: { secret: pw.secret } })).id,
          note: pw.note
        };
      }));
      const paymentSource = await prisma2.networkHandler.create({
        data: {
          network: input.network,
          paymentContractAddress: smartContractAddress,
          paymentType: input.paymentType,
          rpcProviderApiKey: input.rpcProviderApiKey,
          AdminWallets: {
            createMany: {
              data: input.AdminWallets.map((aw, index) => ({
                walletAddress: aw.walletAddress,
                order: index
              }))
            }
          },
          feePermille: input.feePermille,
          FeeReceiverNetworkWallet: {
            create: {
              walletAddress: input.FeeReceiverNetworkWallet.walletAddress,
              order: 0
            }
          },
          CollectionWallet: {
            create: input.CollectionWallet
          },
          SellingWallets: {
            createMany: {
              data: sellingWallets
            }
          },
          PurchasingWallets: {
            createMany: {
              data: purchasingWallets
            }
          }
        }
      });
      return paymentSource;
    });
  }
});
const paymentSourceUpdateSchemaInput = z.object({
  id: z.string().max(250).describe("The id of the payment source to be updated"),
  rpcProviderApiKey: z.string().max(250).optional().describe("The rpc provider (blockfrost) api key to be used for the payment source"),
  CollectionWallet: z.object({
    walletAddress: z.string().max(250),
    note: z.string().max(250)
  }).optional().describe("The wallet address and note of the collection wallet (ideally a hardware wallet). Usually should not be changed. Please backup the mnemonic of the old wallet before changing it."),
  AddPurchasingWallets: z.array(z.object({
    walletMnemonic: z.string().max(1500),
    note: z.string().max(250)
  })).min(1).max(10).optional().describe("The mnemonic of the purchasing wallets to be added"),
  AddSellingWallets: z.array(z.object({
    walletMnemonic: z.string().max(1500),
    note: z.string().max(250)
  })).min(1).max(10).optional().describe("The mnemonic of the selling wallets to be added"),
  RemovePurchasingWallets: z.array(z.object({
    id: z.string()
  })).max(10).optional().describe("The ids of the purchasing wallets to be removed. Please backup the mnemonic of the old wallet before removing it."),
  RemoveSellingWallets: z.array(z.object({
    id: z.string()
  })).max(10).optional().describe("The ids of the selling wallets to be removed. Please backup the mnemonic of the old wallet before removing it."),
  lastPageChecked: z.number({ coerce: true }).min(1).max(1e8).optional().describe("The page number of the payment source. Usually should not be changed"),
  lastIdentifierChecked: z.string().max(250).nullable().optional().describe("The latest identifier of the payment source. Usually should not be changed")
});
const paymentSourceUpdateSchemaOutput = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  network: z.nativeEnum($Enums.Network),
  paymentContractAddress: z.string(),
  paymentType: z.nativeEnum($Enums.PaymentType),
  rpcProviderApiKey: z.string(),
  isSyncing: z.boolean(),
  lastIdentifierChecked: z.string().nullable(),
  lastPageChecked: z.number(),
  lastCheckedAt: z.date().nullable()
});
const paymentSourceEndpointPatch = adminAuthenticatedEndpointFactory.build({
  method: "patch",
  input: paymentSourceUpdateSchemaInput,
  output: paymentSourceUpdateSchemaOutput,
  handler: async ({ input }) => {
    const networkHandler = await prisma.networkHandler.findUnique({
      where: { id: input.id },
      include: {
        PurchasingWallets: true,
        SellingWallets: true
      }
    });
    if (networkHandler == null) {
      throw createHttpError(404, "Payment source not found");
    }
    const sellingWalletsMesh = input.AddSellingWallets?.map((sellingWallet) => {
      return {
        wallet: new MeshWallet({
          networkId: input.network === "PREPROD" ? 0 : 1,
          key: {
            type: "mnemonic",
            words: sellingWallet.walletMnemonic.split(" ")
          }
        }),
        note: sellingWallet.note,
        secret: encrypt(sellingWallet.walletMnemonic)
      };
    });
    const purchasingWalletsMesh = input.AddPurchasingWallets?.map((purchasingWallet) => {
      return {
        wallet: new MeshWallet({
          networkId: input.network === "PREPROD" ? 0 : 1,
          key: {
            type: "mnemonic",
            words: purchasingWallet.walletMnemonic.split(" ")
          }
        }),
        note: purchasingWallet.note,
        secret: encrypt(purchasingWallet.walletMnemonic)
      };
    });
    const result = await prisma.$transaction(async (prisma2) => {
      const sellingWallets = sellingWalletsMesh != null ? await Promise.all(sellingWalletsMesh.map(async (sw) => {
        return {
          walletAddress: (await sw.wallet.getUnusedAddresses())[0],
          walletVkey: resolvePaymentKeyHash$1((await sw.wallet.getUnusedAddresses())[0]),
          walletSecretId: (await prisma2.walletSecret.create({ data: { secret: sw.secret } })).id,
          note: sw.note
        };
      })) : [];
      const purchasingWallets = purchasingWalletsMesh != null ? await Promise.all(purchasingWalletsMesh.map(async (pw) => {
        return {
          walletAddress: (await pw.wallet.getUnusedAddresses())[0],
          walletVkey: resolvePaymentKeyHash$1((await pw.wallet.getUnusedAddresses())[0]),
          walletSecretId: (await prisma2.walletSecret.create({ data: { secret: pw.secret } })).id,
          note: pw.note
        };
      })) : [];
      if (input.RemoveSellingWallets != null && input.RemoveSellingWallets.length > 0 || input.RemovePurchasingWallets != null && input.RemovePurchasingWallets.length > 0) {
        await prisma2.networkHandler.update({
          where: { id: input.id },
          data: {
            SellingWallets: {
              deleteMany: input.RemoveSellingWallets != null && input.RemoveSellingWallets.length > 0 ? {
                id: {
                  in: input.RemoveSellingWallets?.map((rw) => rw.id)
                }
              } : void 0
            },
            PurchasingWallets: {
              deleteMany: input.RemovePurchasingWallets != null && input.RemovePurchasingWallets.length > 0 ? {
                id: {
                  in: input.RemovePurchasingWallets?.map((rw) => rw.id)
                }
              } : void 0
            }
          }
        });
      }
      const paymentSource = await prisma2.networkHandler.update({
        where: { id: input.id },
        data: {
          lastIdentifierChecked: input.lastIdentifierChecked,
          lastPageChecked: input.lastPageChecked,
          rpcProviderApiKey: input.rpcProviderApiKey,
          CollectionWallet: input.CollectionWallet != void 0 ? {
            update: { walletAddress: input.CollectionWallet.walletAddress, note: input.CollectionWallet.note }
          } : void 0,
          SellingWallets: {
            createMany: {
              data: sellingWallets
            }
          },
          PurchasingWallets: {
            createMany: {
              data: purchasingWallets
            }
          }
        }
      });
      return paymentSource;
    });
    return result;
  }
});
const paymentSourceDeleteSchemaInput = z.object({
  id: z.string().describe("The id of the payment source to be deleted")
});
const paymentSourceDeleteSchemaOutput = z.object({
  id: z.string()
});
const paymentSourceEndpointDelete = adminAuthenticatedEndpointFactory.build({
  method: "delete",
  input: paymentSourceDeleteSchemaInput,
  output: paymentSourceDeleteSchemaOutput,
  handler: async ({ input }) => {
    return await prisma.networkHandler.delete({ where: { id: input.id } });
  }
});

const getAPIKeyStatusSchemaInput = z.object({});
const getAPIKeyStatusSchemaOutput = z.object({
  apiKey: z.string(),
  permission: z.nativeEnum(Permission),
  usageLimited: z.boolean(),
  RemainingUsageCredits: z.array(z.object({
    unit: z.string(),
    amount: z.number({ coerce: true }).int().min(0).max(1e8)
  })),
  status: z.nativeEnum(ApiKeyStatus)
});
const queryAPIKeyStatusEndpointGet = authenticatedEndpointFactory.build({
  method: "get",
  input: getAPIKeyStatusSchemaInput,
  output: getAPIKeyStatusSchemaOutput,
  handler: async ({ options }) => {
    const result = await prisma.apiKey.findFirst({ where: { id: options.id }, include: { RemainingUsageCredits: true } });
    if (!result) {
      throw createHttpError(500, "API key not found");
    }
    return { ...result, RemainingUsageCredits: result?.RemainingUsageCredits.map((usageCredit) => ({ unit: usageCredit.unit, amount: parseInt(usageCredit.amount.toString()) })) };
  }
});

const getWalletSchemaInput = z.object({
  walletType: z.enum(["Selling", "Purchasing"]).describe("The type of wallet to query"),
  id: z.string().min(1).max(250).describe("The id of the wallet to query"),
  includeSecret: z.string().transform((s) => s.toLowerCase() == "true" ? true : false).default("false").describe("Whether to include the decrypted secret in the response")
});
const getWalletSchemaOutput = z.object({
  WalletSecret: z.object({
    createdAt: z.date(),
    updatedAt: z.date(),
    secret: z.string()
  }).optional(),
  PendingTransaction: z.object({
    createdAt: z.date(),
    updatedAt: z.date(),
    hash: z.string().nullable(),
    lastCheckedAt: z.date().nullable()
  }).nullable(),
  note: z.string().nullable(),
  walletVkey: z.string(),
  walletAddress: z.string()
});
const queryWalletEndpointGet = adminAuthenticatedEndpointFactory.build({
  method: "get",
  input: getWalletSchemaInput,
  output: getWalletSchemaOutput,
  handler: async ({ input }) => {
    if (input.walletType == "Selling") {
      const result = await prisma.sellingWallet.findFirst({ where: { id: input.id }, include: { WalletSecret: true, PendingTransaction: true, NetworkHandler: true } });
      if (result == null) {
        throw createHttpError(404, "Selling wallet not found");
      }
      if (input.includeSecret == true) {
        const decodedSecret = decrypt(result.WalletSecret.secret);
        return {
          ...result,
          walletSecret: {
            ...result.WalletSecret,
            secret: decodedSecret
          }
        };
      }
      return { ...result, WalletSecret: void 0 };
    } else if (input.walletType == "Purchasing") {
      const result = await prisma.purchasingWallet.findFirst({ where: { id: input.id }, include: { WalletSecret: true, PendingTransaction: true, NetworkHandler: true } });
      if (result == null) {
        throw createHttpError(404, "Purchasing wallet not found");
      }
      if (input.includeSecret == true) {
        const decodedSecret = decrypt(result.WalletSecret.secret);
        return {
          ...result,
          WalletSecret: {
            ...result.WalletSecret,
            secret: decodedSecret
          }
        };
      }
      return { ...result, walletSecret: void 0 };
    }
    throw createHttpError(400, "Invalid wallet type");
  }
});
const postWalletSchemaInput = z.object({
  network: z.nativeEnum(Network).describe("The network the Cardano wallet will be used on")
});
const postWalletSchemaOutput = z.object({
  walletMnemonic: z.string(),
  walletAddress: z.string(),
  walletVkey: z.string()
});
const postWalletEndpointPost = adminAuthenticatedEndpointFactory.build({
  method: "post",
  input: postWalletSchemaInput,
  output: postWalletSchemaOutput,
  handler: async ({ input }) => {
    const secretKey = MeshWallet.brew(false);
    const secretWords = typeof secretKey == "string" ? secretKey.split(" ") : secretKey;
    const networkId = convertNetworkToId(input.network);
    const wallet = new MeshWallet({
      networkId,
      key: {
        type: "mnemonic",
        words: secretWords
      }
    });
    const address = await (await wallet.getUnusedAddresses())[0];
    const vKey = resolvePaymentKeyHash$1(address);
    return {
      walletMnemonic: secretWords.join(" "),
      walletAddress: address,
      walletVkey: vKey
    };
  }
});

const getRpcProviderKeysSchemaInput = z.object({
  cursorId: z.string().min(1).max(250).optional().describe("Used to paginate through the rpc provider keys"),
  limit: z.number({ coerce: true }).min(1).max(100).default(100).describe("The number of rpc provider keys to return")
});
const getRpcProviderKeysSchemaOutput = z.object({
  rpcProviderKeys: z.array(z.object({
    id: z.string(),
    rpcProviderApiKey: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    network: z.nativeEnum($Enums.Network)
  }))
});
const queryRpcProviderKeysEndpointGet = adminAuthenticatedEndpointFactory.build({
  method: "get",
  input: getRpcProviderKeysSchemaInput,
  output: getRpcProviderKeysSchemaOutput,
  handler: async ({ input }) => {
    const rpcProviderKeys = await prisma.networkHandler.findMany({ cursor: input.cursorId ? { id: input.cursorId } : void 0, orderBy: { createdAt: "asc" }, take: input.limit });
    return { rpcProviderKeys };
  }
});

const getUTXOSchemaInput = z.object({
  address: z.string().max(150).describe("The address to get the UTXOs for"),
  network: z.nativeEnum(Network),
  count: z.number({ coerce: true }).int().min(1).max(100).default(10).optional().describe("The number of UTXOs to get"),
  page: z.number({ coerce: true }).int().min(1).max(100).default(1).optional().describe("The page number to get"),
  order: z.enum(["asc", "desc"]).default("desc").optional().describe("The order to get the UTXOs in")
});
const getUTXOSchemaOutput = z.object({
  utxos: z.array(z.object({
    txHash: z.string(),
    address: z.string(),
    amount: z.array(z.object({
      unit: z.string(),
      quantity: z.number({ coerce: true }).int().min(0).max(1e10)
    })),
    data_hash: z.string().optional(),
    inline_datum: z.string().optional(),
    reference_script_hash: z.string().optional(),
    output_index: z.number({ coerce: true }).int().min(0).max(1e9),
    block: z.string()
  }))
});
const queryUTXOEndpointGet = authenticatedEndpointFactory.build({
  method: "get",
  input: getUTXOSchemaInput,
  output: getUTXOSchemaOutput,
  handler: async ({ input }) => {
    const result = await prisma.networkHandler.findFirst({ where: { network: input.network } });
    if (result == null) {
      throw createHttpError(404, "Network not found");
    }
    try {
      const blockfrost = new BlockFrostAPI({ projectId: result.rpcProviderApiKey });
      const utxos = await blockfrost.addressesUtxos(input.address, { count: input.count, page: input.page, order: input.order });
      return { utxos: utxos.map((utxo) => ({ txHash: utxo.tx_hash, address: utxo.address, amount: utxo.amount.map((amount) => ({ unit: amount.unit, quantity: parseInt(amount.quantity) })), output_index: utxo.output_index, block: utxo.block })) };
    } catch (error) {
      if (extractErrorMessage(error).includes("ValueNotConservedUTxO")) {
        throw createHttpError(404, "Wallet not found");
      }
      throw createHttpError(500, "Failed to get UTXOs");
    }
  }
});

const paymentContractSchemaInput = z.object({
  take: z.number({ coerce: true }).min(1).max(100).default(10).describe("The number of payment sources to return"),
  cursorId: z.string().max(250).optional().describe("Used to paginate through the payment sources")
});
const paymentContractSchemaOutput = z.object({
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
      order: z.number()
    })),
    CollectionWallet: z.object({
      id: z.string(),
      walletAddress: z.string(),
      note: z.string().nullable()
    }).nullable(),
    PurchasingWallets: z.array(z.object({
      id: z.string(),
      walletVkey: z.string(),
      walletAddress: z.string(),
      note: z.string().nullable()
    })),
    SellingWallets: z.array(z.object({
      id: z.string(),
      walletVkey: z.string(),
      walletAddress: z.string(),
      note: z.string().nullable()
    })),
    FeeReceiverNetworkWallet: z.object({
      walletAddress: z.string()
    }),
    feePermille: z.number().min(0).max(1e3)
  }))
});
const paymentContractEndpointGet = authenticatedEndpointFactory.build({
  method: "get",
  input: paymentContractSchemaInput,
  output: paymentContractSchemaOutput,
  handler: async ({ input }) => {
    const paymentSources = await prisma.networkHandler.findMany({
      take: input.take,
      orderBy: {
        createdAt: "desc"
      },
      cursor: input.cursorId ? { id: input.cursorId } : void 0,
      include: {
        AdminWallets: { orderBy: { order: "asc" } },
        CollectionWallet: true,
        PurchasingWallets: true,
        SellingWallets: true,
        FeeReceiverNetworkWallet: true
      }
    });
    return { paymentSources };
  }
});

const apiRouter = {
  v1: {
    health: healthEndpointGet,
    "purchase": new DependsOnMethod({
      get: queryPurchaseRequestGet,
      post: createPurchaseInitPost,
      patch: refundPurchasePatch
    }),
    "payment": new DependsOnMethod({
      get: queryPaymentEntryGet,
      post: paymentInitPost,
      patch: paymentUpdatePatch
    }),
    "registry": new DependsOnMethod({
      get: queryAgentGet,
      post: registerAgentPost,
      delete: unregisterAgentDelete
    }),
    "api-key-status": new DependsOnMethod({
      get: queryAPIKeyStatusEndpointGet
    }),
    "api-key": new DependsOnMethod({
      get: queryAPIKeyEndpointGet,
      post: addAPIKeyEndpointPost,
      patch: updateAPIKeyEndpointPatch,
      delete: deleteAPIKeyEndpointDelete
    }),
    "wallet": new DependsOnMethod({
      get: queryWalletEndpointGet,
      post: postWalletEndpointPost
    }),
    "payment-source": new DependsOnMethod({
      get: paymentSourceEndpointGet,
      post: paymentSourceEndpointPost,
      patch: paymentSourceEndpointPatch,
      delete: paymentSourceEndpointDelete
    }),
    "rpc-api-keys": new DependsOnMethod({
      get: queryRpcProviderKeysEndpointGet
    }),
    "utxos": new DependsOnMethod({
      get: queryUTXOEndpointGet
    }),
    "payment-contract": new DependsOnMethod({
      get: paymentContractEndpointGet
    })
  }
};

const router = {
  api: apiRouter
};

extendZodWithOpenApi(z);
const registry = new OpenAPIRegistry();
function generateOpenAPI() {
  registry.registerPath({
    method: "get",
    path: "/health/",
    tags: ["health"],
    summary: "Get the status of the API server",
    request: {},
    responses: {
      200: {
        description: "Object with user data.",
        content: {
          "application/json": {
            schema: healthResponseSchema.openapi({ example: { status: "up" } })
          }
        }
      }
    }
  });
  const apiKeyAuth = registry.registerComponent("securitySchemes", "API-Key", {
    type: "apiKey",
    in: "header",
    name: "token",
    description: "API key authentication via header (token)"
  });
  registry.registerPath({
    method: "get",
    path: "/api-key-status/",
    description: "Gets api key status",
    summary: "REQUIRES API KEY Authentication (+READ)",
    tags: ["api-key-status"],
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "API key status",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: getAPIKeyStatusSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  status: "ACTIVE",
                  apiKey: "masumi_payment_api_key_secret",
                  permission: $Enums.Permission.ADMIN,
                  usageLimited: true,
                  RemainingUsageCredits: [{ unit: "lovelace", amount: 1e6 }]
                }
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "get",
    path: "/wallet/",
    description: "Gets wallet status",
    summary: "REQUIRES API KEY Authentication (+ADMIN)",
    tags: ["wallet"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: getWalletSchemaInput.openapi({
        example: {
          id: "unique_cuid_v2_of_entry_to_delete",
          includeSecret: "true",
          walletType: "Selling"
        }
      })
    },
    responses: {
      200: {
        description: "Wallet status",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: getWalletSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  walletVkey: "wallet_vkey",
                  note: "note",
                  PendingTransaction: null,
                  walletAddress: "wallet_address",
                  WalletSecret: {
                    createdAt: /* @__PURE__ */ new Date(),
                    updatedAt: /* @__PURE__ */ new Date(),
                    secret: "decoded_secret"
                  }
                }
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "post",
    path: "/wallet/",
    description: "Creates a wallet, it will not be saved in the database, please ensure to remember the mnemonic",
    summary: "REQUIRES API KEY Authentication (+ADMIN)",
    tags: ["wallet"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: postWalletSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD
              }
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: "Wallet created",
        content: {
          "application/json": {
            schema: postWalletSchemaOutput.openapi({
              example: {
                walletMnemonic: "wallet_mnemonic",
                walletAddress: "wallet_address",
                walletVkey: "wallet_vkey"
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "get",
    path: "/api-key/",
    description: "Gets api key status",
    summary: "REQUIRES API KEY Authentication (+admin)",
    tags: ["api-key"],
    request: {
      query: getAPIKeySchemaInput.openapi({
        example: {
          limit: 10,
          cursorApiKey: "identifier"
        }
      })
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "Api key status",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: getAPIKeySchemaOutput }).openapi({
              example: {
                data: {
                  apiKeys: [{
                    apiKey: "masumi_payment_api_key_secret",
                    permission: "ADMIN",
                    usageLimited: true,
                    RemainingUsageCredits: [{ unit: "lovelace", amount: 1e6 }],
                    status: "ACTIVE"
                  }]
                },
                status: "success"
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "post",
    path: "/api-key/",
    description: "Creates a API key",
    summary: "REQUIRES API KEY Authentication (+admin)",
    tags: ["api-key"],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: addAPIKeySchemaInput.openapi({
              example: {
                usageLimited: "true",
                UsageCredits: [{ unit: "lovelace", amount: 1e6 }],
                permission: $Enums.Permission.ADMIN
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "API key deleted",
        content: {
          "application/json": {
            schema: z.object({ data: addAPIKeySchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_of_entry_to_delete",
                  apiKey: "masumi_payment_api_key_secret",
                  permission: $Enums.Permission.ADMIN,
                  usageLimited: true,
                  status: $Enums.ApiKeyStatus.ACTIVE
                }
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "patch",
    path: "/api-key/",
    description: "Creates a API key",
    summary: "REQUIRES API KEY Authentication (+admin)",
    tags: ["api-key"],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: updateAPIKeySchemaInput.openapi({
              example: {
                id: "id_or_apiKey_unique_cuid_v2_of_entry_to_update",
                apiKey: "id_or_apiKey_api_key_to_update",
                UsageCredits: [{ unit: "lovelace", amount: 1e6 }],
                status: $Enums.ApiKeyStatus.ACTIVE
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "API key deleted",
        content: {
          "application/json": {
            schema: z.object({ data: updateAPIKeySchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_of_entry_to_delete",
                  apiKey: "masumi_payment_api_key_secret",
                  permission: $Enums.Permission.ADMIN,
                  usageLimited: true,
                  status: $Enums.ApiKeyStatus.ACTIVE
                }
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "delete",
    path: "/api-key/",
    description: "Removes a API key",
    summary: "REQUIRES API KEY Authentication (+admin)",
    tags: ["api-key"],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: deleteAPIKeySchemaInput.openapi({
              example: {
                id: "id_or_apiKey_unique_cuid_v2_of_entry_to_delete",
                apiKey: "id_or_apiKey_api_key_to_delete"
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "API key deleted",
        content: {
          "application/json": {
            schema: z.object({ data: deleteAPIKeySchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_of_entry_to_delete",
                  apiKey: "masumi_registry_api_key_secret"
                }
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "get",
    path: "/payment/",
    description: "Gets the payment status. It needs to be created first with a POST request.",
    summary: "REQUIRES API KEY Authentication (+READ)",
    tags: ["payment"],
    request: {
      query: queryPaymentsSchemaInput.openapi({
        example: {
          limit: 10,
          cursorIdentifier: "identifier",
          network: $Enums.Network.PREPROD,
          paymentContractAddress: "addr_abcd1234567890"
        }
      })
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "Payment status",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: queryPaymentsSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  payments: [{
                    createdAt: /* @__PURE__ */ new Date(),
                    updatedAt: /* @__PURE__ */ new Date(),
                    status: $Enums.PaymentRequestStatus.PaymentRequested,
                    txHash: "tx_hash",
                    utxo: "utxo",
                    errorType: $Enums.PaymentRequestErrorType.NETWORK_ERROR,
                    errorNote: "error_note",
                    errorRequiresManualReview: false,
                    identifier: "identifier",
                    BuyerWallet: { walletVkey: "wallet_vkey" },
                    SmartContractWallet: { id: "unique_cuid_v2_auto_generated", walletAddress: "wallet_address", walletVkey: "wallet_vkey", note: "note" },
                    Amounts: [{ id: "unique_cuid_v2_auto_generated", createdAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date(), amount: 1e6, unit: "unit" }],
                    NetworkHandler: { id: "unique_cuid_v2_auto_generated", network: $Enums.Network.PREPROD, paymentContractAddress: "address_to_check", paymentType: $Enums.PaymentType.WEB3_CARDANO_V1 }
                  }]
                }
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "post",
    path: "/payment/",
    description: "Creates a payment request and identifier. This will check incoming payments in the background.",
    summary: "REQUIRES API KEY Authentication (+PAY)",
    tags: ["payment"],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: createPaymentsSchemaInput.openapi({
              example: {
                agentIdentifier: "agent_identifier",
                network: $Enums.Network.PREPROD,
                paymentContractAddress: "address",
                amounts: [{ amount: 1e6, unit: "lovelace" }],
                paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                submitResultTime: new Date(Date.now() + 1e3 * 60 * 60 * 12).toISOString()
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "Payment request created",
        content: {
          "application/json": {
            schema: z.object({ data: createPaymentSchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  identifier: "agent_identifier_unique_cuid_v2_auto_generated",
                  createdAt: /* @__PURE__ */ new Date(),
                  updatedAt: /* @__PURE__ */ new Date(),
                  status: $Enums.PaymentRequestStatus.PaymentRequested,
                  txHash: "tx_hash",
                  utxo: "utxo",
                  errorType: $Enums.PaymentRequestErrorType.NETWORK_ERROR,
                  errorNote: "error_note",
                  errorRequiresManualReview: false,
                  Amounts: [{ id: "unique_cuid_v2_auto_generated", createdAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date(), amount: 1e6, unit: "lovelace" }],
                  SmartContractWallet: { id: "unique_cuid_v2_auto_generated", walletAddress: "wallet_address", walletVkey: "wallet_vkey", note: "note" },
                  BuyerWallet: null,
                  NetworkHandler: { id: "unique_cuid_v2_auto_generated", network: $Enums.Network.PREPROD, paymentContractAddress: "address", paymentType: $Enums.PaymentType.WEB3_CARDANO_V1 }
                }
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "patch",
    path: "/payment/",
    description: "Completes a payment request. This will collect the funds after the unlock time.",
    summary: "REQUIRES API KEY Authentication (+PAY)",
    tags: ["payment"],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: updatePaymentsSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD,
                paymentContractAddress: "address",
                hash: "hash",
                identifier: "identifier"
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "API key deleted",
        content: {
          "application/json": {
            schema: z.object({ data: updatePaymentSchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_auto_generated",
                  createdAt: /* @__PURE__ */ new Date(),
                  updatedAt: /* @__PURE__ */ new Date(),
                  status: $Enums.PaymentRequestStatus.PaymentRequested
                }
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "get",
    path: "/purchase/",
    description: "Gets the purchase status. It needs to be created first with a POST request.",
    summary: "REQUIRES API KEY Authentication (+READ)",
    tags: ["purchase"],
    request: {
      query: queryPurchaseRequestSchemaInput.openapi({
        example: {
          limit: 10,
          cursorIdentifier: "identifier",
          cursorIdentifierSellingWalletVkey: "wallet_vkey",
          network: $Enums.Network.PREPROD,
          paymentContractAddress: "addr_abcd1234567890"
        }
      })
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "Purchase status",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: queryPurchaseRequestSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  purchases: [{
                    createdAt: /* @__PURE__ */ new Date(),
                    updatedAt: /* @__PURE__ */ new Date(),
                    status: $Enums.PurchasingRequestStatus.PurchaseRequested,
                    txHash: "tx_hash",
                    utxo: "utxo",
                    errorType: $Enums.PurchaseRequestErrorType.NETWORK_ERROR,
                    errorNote: "error_note",
                    errorRequiresManualReview: false,
                    identifier: "identifier",
                    SmartContractWallet: { id: "unique_cuid_v2_auto_generated", walletAddress: "wallet_address", walletVkey: "wallet_vkey", note: "note" },
                    Amounts: [{ id: "unique_cuid_v2_auto_generated", createdAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date(), amount: 1e6, unit: "lovelace" }],
                    NetworkHandler: { id: "unique_cuid_v2_auto_generated", network: $Enums.Network.PREPROD, paymentContractAddress: "address_to_check", paymentType: $Enums.PaymentType.WEB3_CARDANO_V1 },
                    SellerWallet: { walletVkey: "wallet_vkey", note: "note" }
                  }]
                }
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "post",
    path: "/purchase/",
    description: "Creates a purchase and pays the seller. This requires funds to be available.",
    summary: "REQUIRES API KEY Authentication (+PAY)",
    tags: ["purchase"],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: createPurchaseInitSchemaInput.openapi({
              example: {
                identifier: "identifier",
                network: $Enums.Network.PREPROD,
                sellerVkey: "seller_vkey",
                paymentContractAddress: "address",
                amounts: [{ amount: 1e6, unit: "lovelace" }],
                paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                submitResultTime: new Date(Date.now() + 1e3 * 60 * 60 * 12).toISOString(),
                unlockTime: new Date(Date.now() + 1e3 * 60 * 60 * 24).toISOString(),
                refundTime: new Date(Date.now() + 1e3 * 60 * 60 * 36).toISOString()
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "Purchase request created",
        content: {
          "application/json": {
            schema: z.object({ data: createPurchaseInitSchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_auto_generated",
                  createdAt: /* @__PURE__ */ new Date(),
                  updatedAt: /* @__PURE__ */ new Date(),
                  status: $Enums.PurchasingRequestStatus.PurchaseRequested
                }
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "patch",
    path: "/purchase/",
    description: "Requests a refund for a completed purchase. This will collect the refund after the refund time.",
    summary: "REQUIRES API KEY Authentication (+PAY)",
    tags: ["purchase"],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: refundPurchaseSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD,
                paymentContractAddress: "address",
                identifier: "identifier"
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: "API key deleted",
        content: {
          "application/json": {
            schema: z.object({ data: refundPurchaseSchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  txHash: "tx_hash"
                }
              }
            })
          }
        }
      },
      400: {
        description: "Bad Request (possible parameters missing or invalid)"
      },
      401: {
        description: "Unauthorized"
      },
      500: {
        description: "Internal Server Error"
      }
    }
  });
  registry.registerPath({
    method: "get",
    path: "/registry/",
    description: "Gets the agent metadata.",
    summary: "REQUIRES API KEY Authentication (+READ)",
    tags: ["registry"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: queryAgentSchemaInput.openapi({
        example: {
          walletVKey: "wallet_vkey",
          network: $Enums.Network.PREPROD,
          paymentContractAddress: "address"
        }
      })
    },
    responses: {
      200: {
        description: "Agent metadata",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: queryAgentSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  assets: [
                    {
                      unit: "unit",
                      metadata: {
                        name: "name",
                        description: "description",
                        api_url: "api_url",
                        example_output: "example_output",
                        tags: ["tag1", "tag2"],
                        capability: {
                          name: "capability_name",
                          version: "capability_version"
                        },
                        author: {
                          name: "author_name",
                          contact: "author_contact",
                          organization: "author_organization"
                        },
                        legal: {
                          privacy_policy: "privacy_policy",
                          terms: "terms",
                          other: "other"
                        },
                        image: "image",
                        pricing: [{
                          quantity: 1e6,
                          unit: "unit"
                        }],
                        metadata_version: 1
                      }
                    }
                  ]
                }
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "post",
    path: "/registry/",
    description: "Registers an agent to the registry.",
    summary: "REQUIRES API KEY Authentication (+PAY)",
    tags: ["registry"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: registerAgentSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD,
                paymentContractAddress: "addr_test1",
                tags: ["tag1", "tag2"],
                name: "Agent Name",
                api_url: "https://api.example.com",
                description: "Agent Description",
                author: {
                  name: "Author Name",
                  contact: "author@example.com",
                  organization: "Author Organization"
                },
                legal: {
                  privacy_policy: "Privacy Policy URL",
                  terms: "Terms of Service URL",
                  other: "Other Legal Information URL"
                },
                sellingWalletVkey: "wallet_vkey",
                capability: { name: "Capability Name", version: "1.0.0" },
                requests_per_hour: "100",
                pricing: [{
                  unit: "usdm",
                  quantity: "500000000"
                }]
              }
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: "Agent registered",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: registerAgentSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  txHash: "tx_hash"
                }
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "delete",
    path: "/registry/",
    description: "Deregisters a agent from the specified registry.",
    summary: "REQUIRES API KEY Authentication (+PAY)",
    tags: ["registry"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: unregisterAgentSchemaInput.openapi({
        example: { assetName: "asset_name", network: $Enums.Network.PREPROD, paymentContractAddress: "address" }
      })
    },
    responses: {
      200: {
        description: "Payment source deleted",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: unregisterAgentSchemaOutput }).openapi({
              example: { status: "success", data: { txHash: "tx_hash" } }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "get",
    path: "/payment-contract/",
    description: "Gets the payment contract.",
    summary: "REQUIRES API KEY Authentication (+READ)",
    tags: ["payment-contract"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: paymentContractSchemaInput.openapi({
        example: {
          take: 10,
          cursorId: "cursor_id"
        }
      })
    },
    responses: {
      200: {
        description: "Payment source status",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: paymentContractSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  paymentSources: [{
                    id: "unique_cuid_v2_auto_generated",
                    createdAt: /* @__PURE__ */ new Date(),
                    updatedAt: /* @__PURE__ */ new Date(),
                    network: $Enums.Network.PREPROD,
                    paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                    paymentContractAddress: "address_of_the_smart_contract",
                    lastPageChecked: 1,
                    lastCheckedAt: /* @__PURE__ */ new Date(),
                    lastIdentifierChecked: null,
                    AdminWallets: [{ walletAddress: "wallet_address", order: 0 }, { walletAddress: "wallet_address", order: 1 }, { walletAddress: "wallet_address", order: 2 }],
                    CollectionWallet: { id: "unique_cuid_v2_auto_generated", walletAddress: "wallet_address", note: "note" },
                    PurchasingWallets: [{ id: "unique_cuid_v2_auto_generated", walletVkey: "wallet_vkey", walletAddress: "wallet_address", note: "note" }],
                    SellingWallets: [{ id: "unique_cuid_v2_auto_generated", walletVkey: "wallet_vkey", walletAddress: "wallet_address", note: "note" }],
                    FeeReceiverNetworkWallet: { walletAddress: "wallet_address" },
                    feePermille: 50
                  }]
                }
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "get",
    path: "/payment-source/",
    description: "Gets the payment sources including the status.",
    summary: "REQUIRES API KEY Authentication (+ADMIN)",
    tags: ["payment-source"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: paymentSourceSchemaInput.openapi({
        example: {
          take: 10,
          cursorId: "cursor_id"
        }
      })
    },
    responses: {
      200: {
        description: "Payment source status",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: paymentSourceSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  paymentSources: [{
                    id: "unique_cuid_v2_auto_generated",
                    createdAt: /* @__PURE__ */ new Date(),
                    updatedAt: /* @__PURE__ */ new Date(),
                    network: $Enums.Network.PREPROD,
                    paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                    paymentContractAddress: "address_of_the_smart_contract",
                    rpcProviderApiKey: "rpc_provider_api_key",
                    isSyncing: false,
                    lastPageChecked: 1,
                    lastCheckedAt: /* @__PURE__ */ new Date(),
                    lastIdentifierChecked: null,
                    AdminWallets: [{ walletAddress: "wallet_address", order: 0 }, { walletAddress: "wallet_address", order: 1 }, { walletAddress: "wallet_address", order: 2 }],
                    CollectionWallet: { id: "unique_cuid_v2_auto_generated", walletAddress: "wallet_address", note: "note" },
                    PurchasingWallets: [{ id: "unique_cuid_v2_auto_generated", walletVkey: "wallet_vkey", walletAddress: "wallet_address", note: "note" }],
                    SellingWallets: [{ id: "unique_cuid_v2_auto_generated", walletVkey: "wallet_vkey", walletAddress: "wallet_address", note: "note" }],
                    FeeReceiverNetworkWallet: { walletAddress: "wallet_address" },
                    feePermille: 50
                  }]
                }
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "post",
    path: "/payment-source/",
    description: "Creates a payment source.",
    summary: "REQUIRES API KEY Authentication (+ADMIN)",
    tags: ["payment-source"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: paymentSourceCreateSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD,
                paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                rpcProviderApiKey: "rpc_provider_api_key",
                AdminWallets: [{ walletAddress: "wallet_address_1" }, { walletAddress: "wallet_address_2" }, { walletAddress: "wallet_address_3" }],
                FeeReceiverNetworkWallet: { walletAddress: "wallet_address" },
                feePermille: 50,
                CollectionWallet: { walletAddress: "wallet_address", note: "note" },
                PurchasingWallets: [{ walletMnemonic: "wallet mnemonic", note: "note" }],
                SellingWallets: [{ walletMnemonic: "wallet mnemonic", note: "note" }]
              }
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: "Payment source created",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: paymentSourceCreateSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_auto_generated",
                  createdAt: /* @__PURE__ */ new Date(),
                  updatedAt: /* @__PURE__ */ new Date(),
                  network: $Enums.Network.PREPROD,
                  paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                  paymentContractAddress: "address_of_the_smart_contract",
                  rpcProviderApiKey: "rpc_provider_api_key",
                  isSyncing: false,
                  lastPageChecked: 1,
                  lastCheckedAt: /* @__PURE__ */ new Date(),
                  lastIdentifierChecked: null
                }
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "patch",
    path: "/payment-source/",
    description: "Creates a payment source.",
    summary: "REQUIRES API KEY Authentication (+ADMIN)",
    tags: ["payment-source"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      body: {
        description: "",
        content: {
          "application/json": {
            schema: paymentSourceUpdateSchemaInput.openapi({
              example: {
                id: "unique_cuid_v2",
                lastIdentifierChecked: "optional_identifier",
                lastPageChecked: 1,
                rpcProviderApiKey: "rpc_provider_api_key",
                CollectionWallet: { walletAddress: "wallet_address", note: "note" },
                AddPurchasingWallets: [{ walletMnemonic: "wallet_mnemonic", note: "note" }],
                AddSellingWallets: [{ walletMnemonic: "wallet_mnemonic", note: "note" }],
                RemovePurchasingWallets: [{ id: "unique_cuid_v2" }],
                RemoveSellingWallets: [{ id: "unique_cuid_v2" }]
              }
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: "Payment source created",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: paymentSourceUpdateSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  paymentContractAddress: "address_of_the_smart_contract",
                  id: "unique_cuid_v2_auto_generated",
                  createdAt: /* @__PURE__ */ new Date(),
                  updatedAt: /* @__PURE__ */ new Date(),
                  network: $Enums.Network.PREPROD,
                  paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                  rpcProviderApiKey: "rpc_provider_api_key",
                  lastPageChecked: 1,
                  lastCheckedAt: /* @__PURE__ */ new Date(),
                  lastIdentifierChecked: null,
                  isSyncing: false
                }
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "delete",
    path: "/payment-source/",
    description: "Deletes a payment source. WARNING will also delete all associated wallets and transactions.",
    summary: "REQUIRES API KEY Authentication (+ADMIN)",
    tags: ["payment-source"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: paymentSourceDeleteSchemaInput.openapi({
        example: { id: "unique_cuid_v2_auto_generated" }
      })
    },
    responses: {
      200: {
        description: "Payment source deleted",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), data: paymentSourceDeleteSchemaOutput }).openapi({
              example: { status: "success", data: { id: "unique_cuid_v2_auto_generated" } }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "get",
    path: "/utxos/",
    description: "Gets UTXOs (internal)",
    summary: "REQUIRES API KEY Authentication (+READ)",
    tags: ["utxos"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: getUTXOSchemaInput.openapi({
        example: {
          network: $Enums.Network.PREPROD,
          address: "addr1qx2ej34k567890",
          count: 10,
          page: 1,
          order: "desc"
        }
      })
    },
    responses: {
      200: {
        description: "UTXOs",
        content: {
          "application/json": {
            schema: getUTXOSchemaOutput.openapi({
              example: {
                utxos: [{ txHash: "tx_hash", address: "addr1qx2ej34k567890", amount: [{ unit: "lovelace", quantity: 1e6 }], output_index: 1, block: "1" }]
              }
            })
          }
        }
      }
    }
  });
  registry.registerPath({
    method: "get",
    path: "/rpc-api-keys/",
    description: "Gets rpc api keys, currently only blockfrost is supported (internal)",
    summary: "REQUIRES API KEY Authentication (+ADMIN)",
    tags: ["rpc-api-keys"],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: getRpcProviderKeysSchemaInput.openapi({
        example: {
          cursorId: "unique_cuid_v2",
          limit: 50
        }
      })
    },
    responses: {
      200: {
        description: "Blockfrost keys",
        content: {
          "application/json": {
            schema: getRpcProviderKeysSchemaOutput.openapi({
              example: {
                rpcProviderKeys: [{ network: $Enums.Network.PREPROD, id: "unique_cuid_v2", rpcProviderApiKey: "blockfrost_api_key", createdAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() }]
              }
            })
          }
        }
      }
    }
  });
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "Template API",
      description: "This is the default API from a template"
    },
    servers: [{ url: "./../api/v1/" }]
  });
}

const __dirname = path.resolve();
async function initialize() {
  await initDB();
  await init();
}
initialize().then(async () => {
  const PORT = CONFIG.PORT;
  const serverConfig = createConfig({
    inputSources: {
      //read from body on get requests
      get: ["query", "params"],
      post: ["body", "params", "files"],
      put: ["body", "params"],
      patch: ["body", "params"],
      delete: ["query", "params"]
    },
    startupLogo: false,
    beforeRouting: ({ app }) => {
      logger.info("Serving the API documentation at localhost:" + PORT + "/docs");
      app.use("/docs", ui.serve, ui.setup(generateOpenAPI(), {
        explorer: false,
        swaggerOptions: {
          persistAuthorization: true,
          tryItOutEnabled: true
        }
      }));
      app.use("/admin", express.static("frontend/dist"));
      app.use("/_next", express.static("frontend/dist/_next"));
      app.get("/admin/*name", (req, res) => {
        res.sendFile(path.join(__dirname, "frontend/dist/index.html"));
      });
    },
    http: {
      listen: PORT
    },
    cors: ({ defaultHeaders }) => ({
      ...defaultHeaders,
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "5000",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH",
      "Access-Control-Expose-Headers": "Content-Range, X-Total-Count"
    }),
    logger
  });
  createServer(serverConfig, router);
}).catch((e) => {
  throw e;
}).finally(async () => {
  await cleanupDB();
});
