import { z } from 'zod';
import {
  HotWalletType,
  Network,
  PaymentType,
  PurchasingAction,
  TransactionStatus,
  PurchaseErrorType,
  OnChainState,
  PricingType,
  $Enums,
} from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { DEFAULTS } from '@/utils/config';
import { payAuthenticatedEndpointFactory } from '@/utils/security/auth/pay-authenticated';
import { checkIsAllowedNetworkOrThrowUnauthorized } from '@/utils/middleware/auth-middleware';
import { checkSignature, resolvePaymentKeyHash } from '@meshsdk/core';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { getRegistryScriptV1 } from '@/utils/generator/contract-generator';
import { logger } from '@/utils/logger';
import { metadataSchema } from '../registry/wallet';
import { metadataToString } from '@/utils/converter/metadata-string-convert';
import { handlePurchaseCreditInit } from '@/services/token-credit';
import stringify from 'canonical-json';
import { getPublicKeyFromCoseKey } from '@/utils/converter/public-key-convert';
import LZString from 'lz-string';
import { generateHash } from '@/utils/crypto';

export const queryPurchaseRequestSchemaInput = z.object({
  limit: z
    .number({ coerce: true })
    .min(1)
    .max(100)
    .default(10)
    .describe('The number of purchases to return'),
  cursorId: z
    .string()
    .optional()
    .describe(
      'Used to paginate through the purchases. If this is provided, cursorId is required',
    ),
  network: z
    .nativeEnum(Network)
    .describe('The network the purchases were made on'),
  smartContractAddress: z
    .string()
    .max(250)
    .optional()
    .describe(
      'The address of the smart contract where the purchases were made to',
    ),
  includeHistory: z
    .string()
    .optional()
    .transform((val) => val?.toLowerCase() == 'true')
    .default('false')
    .describe(
      'Whether to include the full transaction and status history of the purchases',
    ),
});

export const queryPurchaseRequestSchemaOutput = z.object({
  Purchases: z.array(
    z.object({
      id: z.string(),
      createdAt: z.date(),
      updatedAt: z.date(),
      blockchainIdentifier: z.string(),
      lastCheckedAt: z.date().nullable(),
      submitResultTime: z.string(),
      unlockTime: z.string(),
      externalDisputeUnlockTime: z.string(),
      requestedById: z.string(),
      onChainState: z.nativeEnum(OnChainState).nullable(),
      cooldownTime: z.number(),
      cooldownTimeOtherParty: z.number(),
      inputHash: z.string(),
      resultHash: z.string(),
      NextAction: z.object({
        inputHash: z.string(),
        requestedAction: z.nativeEnum(PurchasingAction),
        errorType: z.nativeEnum(PurchaseErrorType).nullable(),
        errorNote: z.string().nullable(),
      }),
      CurrentTransaction: z
        .object({
          id: z.string(),
          createdAt: z.date(),
          updatedAt: z.date(),
          txHash: z.string(),
          status: z.nativeEnum(TransactionStatus),
        })
        .nullable(),
      TransactionHistory: z.array(
        z.object({
          id: z.string(),
          createdAt: z.date(),
          updatedAt: z.date(),
          txHash: z.string(),
          status: z.nativeEnum(TransactionStatus),
        }),
      ),
      PaidFunds: z.array(
        z.object({
          amount: z.string(),
          unit: z.string(),
        }),
      ),
      WithdrawnForSeller: z.array(
        z.object({
          amount: z.string(),
          unit: z.string(),
        }),
      ),
      WithdrawnForBuyer: z.array(
        z.object({
          amount: z.string(),
          unit: z.string(),
        }),
      ),
      PaymentSource: z.object({
        id: z.string(),
        network: z.nativeEnum(Network),
        smartContractAddress: z.string(),
        paymentType: z.nativeEnum(PaymentType),
      }),
      SellerWallet: z
        .object({
          id: z.string(),
          walletVkey: z.string(),
        })
        .nullable(),
      SmartContractWallet: z
        .object({
          id: z.string(),
          walletVkey: z.string(),
          walletAddress: z.string(),
        })
        .nullable(),
      metadata: z.string().nullable(),
    }),
  ),
});

export const queryPurchaseRequestGet = payAuthenticatedEndpointFactory.build({
  method: 'get',
  input: queryPurchaseRequestSchemaInput,
  output: queryPurchaseRequestSchemaOutput,
  handler: async ({
    input,
    options,
  }: {
    input: z.infer<typeof queryPurchaseRequestSchemaInput>;
    options: {
      id: string;
      permission: $Enums.Permission;
      networkLimit: $Enums.Network[];
      usageLimited: boolean;
    };
  }) => {
    await checkIsAllowedNetworkOrThrowUnauthorized(
      options.networkLimit,
      input.network,
      options.permission,
    );
    const paymentContractAddress =
      input.smartContractAddress ??
      (input.network == Network.Mainnet
        ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET
        : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const paymentSource = await prisma.paymentSource.findUnique({
      where: {
        network_smartContractAddress: {
          network: input.network,
          smartContractAddress: paymentContractAddress,
        },
        deletedAt: null,
      },
    });
    if (paymentSource == null) {
      throw createHttpError(404, 'Payment source not found');
    }

    const result = await prisma.purchaseRequest.findMany({
      where: { paymentSourceId: paymentSource.id },
      cursor: input.cursorId ? { id: input.cursorId } : undefined,
      take: input.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        SellerWallet: true,
        SmartContractWallet: { where: { deletedAt: null } },
        PaidFunds: true,
        NextAction: true,
        PaymentSource: true,
        CurrentTransaction: true,
        WithdrawnForSeller: true,
        WithdrawnForBuyer: true,
        TransactionHistory: {
          orderBy: { createdAt: 'desc' },
          take: input.includeHistory == true ? undefined : 0,
        },
      },
    });
    if (result == null) {
      throw createHttpError(404, 'Purchase not found');
    }
    return {
      Purchases: result.map((purchase) => ({
        ...purchase,
        PaidFunds: (
          purchase.PaidFunds as Array<{ unit: string; amount: bigint }>
        ).map((amount) => ({
          ...amount,
          amount: amount.amount.toString(),
        })),
        WithdrawnForSeller: (
          purchase.WithdrawnForSeller as Array<{ unit: string; amount: bigint }>
        ).map((amount) => ({
          unit: amount.unit,
          amount: amount.amount.toString(),
        })),
        WithdrawnForBuyer: (
          purchase.WithdrawnForBuyer as Array<{ unit: string; amount: bigint }>
        ).map((amount) => ({
          unit: amount.unit,
          amount: amount.amount.toString(),
        })),
        submitResultTime: purchase.submitResultTime.toString(),
        unlockTime: purchase.unlockTime.toString(),
        externalDisputeUnlockTime:
          purchase.externalDisputeUnlockTime.toString(),
        cooldownTime: Number(purchase.buyerCoolDownTime),
        cooldownTimeOtherParty: Number(purchase.sellerCoolDownTime),
      })),
    };
  },
});

export const createPurchaseInitSchemaInput = z.object({
  blockchainIdentifier: z
    .string()
    .max(8000)
    .describe('The identifier of the purchase. Is provided by the seller'),
  network: z
    .nativeEnum(Network)
    .describe('The network the transaction will be made on'),
  inputHash: z.string().max(250),
  sellerVkey: z
    .string()
    .max(250)
    .describe('The verification key of the seller'),
  agentIdentifier: z
    .string()
    .max(250)
    .describe('The identifier of the agent that is being purchased'),
  smartContractAddress: z
    .string()
    .max(250)
    .optional()
    .describe(
      'The address of the smart contract where the purchase will be made to',
    ),
  Amounts: z
    .array(z.object({ amount: z.string().max(25), unit: z.string().max(150) }))
    .max(7)
    .optional()
    .describe('The amounts to be paid for the purchase'),
  paymentType: z
    .nativeEnum(PaymentType)
    .describe('The payment type of smart contract used'),
  unlockTime: z
    .string()
    .describe(
      'The time after which the purchase will be unlocked. In unix time (number)',
    ),
  externalDisputeUnlockTime: z
    .string()
    .describe(
      'The time after which the purchase will be unlocked for external dispute. In unix time (number)',
    ),
  submitResultTime: z
    .string()
    .describe(
      'The time by which the result has to be submitted. In unix time (number)',
    ),
  metadata: z
    .string()
    .optional()
    .describe('Metadata to be stored with the purchase request'),
  identifierFromPurchaser: z
    .string()
    .min(15)
    .max(25)
    .describe('The cuid2 identifier of the purchaser of the purchase'),
});

export const createPurchaseInitSchemaOutput = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  blockchainIdentifier: z.string(),
  lastCheckedAt: z.date().nullable(),
  submitResultTime: z.string(),
  unlockTime: z.string(),
  externalDisputeUnlockTime: z.string(),
  requestedById: z.string(),
  resultHash: z.string(),
  inputHash: z.string(),
  onChainState: z.nativeEnum(OnChainState).nullable(),
  NextAction: z.object({
    requestedAction: z.nativeEnum(PurchasingAction),
    errorType: z.nativeEnum(PurchaseErrorType).nullable(),
    errorNote: z.string().nullable(),
  }),
  CurrentTransaction: z
    .object({
      id: z.string(),
      createdAt: z.date(),
      updatedAt: z.date(),
      txHash: z.string(),
      status: z.nativeEnum(TransactionStatus),
    })
    .nullable(),
  PaidFunds: z.array(
    z.object({
      amount: z.string(),
      unit: z.string(),
    }),
  ),
  WithdrawnForSeller: z.array(
    z.object({
      amount: z.string(),
      unit: z.string(),
    }),
  ),
  WithdrawnForBuyer: z.array(
    z.object({
      amount: z.string(),
      unit: z.string(),
    }),
  ),
  PaymentSource: z.object({
    id: z.string(),
    network: z.nativeEnum(Network),
    smartContractAddress: z.string(),
    paymentType: z.nativeEnum(PaymentType),
  }),
  SellerWallet: z
    .object({
      id: z.string(),
      walletVkey: z.string(),
    })
    .nullable(),
  SmartContractWallet: z
    .object({
      id: z.string(),
      walletVkey: z.string(),
      walletAddress: z.string(),
    })
    .nullable(),
  metadata: z.string().nullable(),
});

export const createPurchaseInitPost = payAuthenticatedEndpointFactory.build({
  method: 'post',
  input: createPurchaseInitSchemaInput,
  output: createPurchaseInitSchemaOutput,
  handler: async ({
    input,
    options,
  }: {
    input: z.infer<typeof createPurchaseInitSchemaInput>;
    options: {
      id: string;
      permission: $Enums.Permission;
      networkLimit: $Enums.Network[];
      usageLimited: boolean;
    };
  }) => {
    await checkIsAllowedNetworkOrThrowUnauthorized(
      options.networkLimit,
      input.network,
      options.permission,
    );
    const smartContractAddress =
      input.smartContractAddress ??
      (input.network == Network.Mainnet
        ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET
        : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const paymentSource = await prisma.paymentSource.findUnique({
      where: {
        network_smartContractAddress: {
          network: input.network,
          smartContractAddress: smartContractAddress,
        },
        deletedAt: null,
      },
      include: { PaymentSourceConfig: true },
    });
    if (paymentSource == null) {
      throw createHttpError(
        404,
        'Network and Address combination not supported',
      );
    }

    const wallets = await prisma.hotWallet.aggregate({
      where: {
        paymentSourceId: paymentSource.id,
        type: HotWalletType.Selling,
        deletedAt: null,
      },
      _count: true,
    });
    if (wallets._count === 0) {
      throw createHttpError(404, 'No valid purchasing wallets found');
    }
    //require at least 3 hours between unlock time and the submit result time
    const additionalExternalDisputeUnlockTime = BigInt(1000 * 60 * 15);
    const submitResultTime = BigInt(input.submitResultTime);
    const unlockTime = BigInt(input.unlockTime);
    const externalDisputeUnlockTime = BigInt(input.externalDisputeUnlockTime);
    if (
      externalDisputeUnlockTime <
      unlockTime + additionalExternalDisputeUnlockTime
    ) {
      throw createHttpError(
        400,
        'External dispute unlock time must be after unlock time with at least 15 minutes difference',
      );
    }
    if (submitResultTime < BigInt(Date.now() + 1000 * 60 * 15)) {
      throw createHttpError(
        400,
        'Submit result time must be in the future (min. 15 minutes)',
      );
    }
    const offset = BigInt(1000 * 60 * 15);
    if (submitResultTime > unlockTime - offset) {
      throw createHttpError(
        400,
        'Submit result time must be before unlock time with at least 15 minutes difference',
      );
    }
    const provider = new BlockFrostAPI({
      projectId: paymentSource.PaymentSourceConfig.rpcProviderApiKey,
    });

    const { policyId } = await getRegistryScriptV1(
      smartContractAddress,
      input.network,
    );
    const assetId = input.agentIdentifier;
    const policyAsset = assetId.startsWith(policyId)
      ? assetId
      : policyId + assetId;
    const assetInWallet = await provider.assetsAddresses(policyAsset, {
      order: 'desc',
      count: 1,
    });

    if (assetInWallet.length == 0) {
      throw createHttpError(404, 'Agent identifier not found');
    }
    const addressOfAsset = assetInWallet[0].address;
    if (addressOfAsset == null) {
      throw createHttpError(404, 'Agent identifier not found');
    }

    const vKey = resolvePaymentKeyHash(addressOfAsset);
    if (vKey != input.sellerVkey) {
      throw createHttpError(400, 'Invalid seller vkey');
    }

    const assetInfo = await provider.assetsById(assetId);
    if (!assetInfo.onchain_metadata) {
      throw createHttpError(404, 'Agent identifier not found');
    }
    const parsedMetadata = metadataSchema.safeParse(assetInfo.onchain_metadata);

    if (!parsedMetadata.success || !parsedMetadata.data) {
      const error = parsedMetadata.error;
      logger.error('Error parsing metadata', { error });
      throw createHttpError(404, 'Agent identifier metadata invalid');
    }

    const pricing = parsedMetadata.data.agentPricing;
    if (pricing.pricingType != PricingType.Fixed) {
      throw createHttpError(400, 'Agent identifier pricing type not supported');
    }
    const amounts = pricing.fixedPricing;

    const agentIdentifierAmountsMap = new Map<string, bigint>();
    for (const amount of amounts) {
      const unit =
        metadataToString(amount.unit)!.toLowerCase() == ''
          ? ''
          : metadataToString(amount.unit)!;
      if (agentIdentifierAmountsMap.has(unit)) {
        agentIdentifierAmountsMap.set(
          unit,
          agentIdentifierAmountsMap.get(unit)! + BigInt(amount.amount),
        );
      } else {
        agentIdentifierAmountsMap.set(unit, BigInt(amount.amount));
      }
    }
    //for fixed pricing, the amounts must not be provided
    if (input.Amounts != undefined) {
      throw createHttpError(
        400,
        'Agent identifier amounts must not be provided for fixed pricing',
      );
    }

    const decompressedEncodedBlockchainIdentifier =
      LZString.decompressFromUint8Array(
        Buffer.from(input.blockchainIdentifier, 'hex'),
      );
    const blockchainIdentifierSplit =
      decompressedEncodedBlockchainIdentifier.split('.');
    if (blockchainIdentifierSplit.length != 4) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, format invalid',
      );
    }
    const sellerId = blockchainIdentifierSplit[0];
    const purchaserId = blockchainIdentifierSplit[1];
    const purchaserIdDecoded = Buffer.from(purchaserId, 'hex').toString(
      'utf-8',
    );
    if (purchaserIdDecoded != input.identifierFromPurchaser) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, purchaser id mismatch',
      );
    }
    const signature = blockchainIdentifierSplit[2];
    const key = blockchainIdentifierSplit[3];
    const cosePublicKey = getPublicKeyFromCoseKey(key);
    if (cosePublicKey == null) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, key not found',
      );
    }
    const publicKeyHash = await cosePublicKey.hash();
    if (publicKeyHash.hex() != input.sellerVkey) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, key does not match',
      );
    }

    const reconstructedBlockchainIdentifier = {
      inputHash: input.inputHash,
      agentIdentifier: input.agentIdentifier,
      purchaserIdentifier: purchaserIdDecoded,
      sellerIdentifier: sellerId,
      //RequestedFunds: is null for fixed pricing
      RequestedFunds: null,
      submitResultTime: input.submitResultTime,
      unlockTime: unlockTime.toString(),
      externalDisputeUnlockTime: externalDisputeUnlockTime.toString(),
    };

    const hashedBlockchainIdentifier = generateHash(
      stringify(reconstructedBlockchainIdentifier),
    );

    const identifierIsSignedCorrectly = checkSignature(
      hashedBlockchainIdentifier,
      {
        signature: signature,
        key: key,
      },
    );
    if (!identifierIsSignedCorrectly) {
      throw createHttpError(
        400,
        'Invalid blockchain identifier, signature invalid',
      );
    }

    const initialPurchaseRequest = await handlePurchaseCreditInit({
      id: options.id,
      cost: Array.from(agentIdentifierAmountsMap.entries()).map(
        ([unit, amount]) => {
          if (unit.toLowerCase() == 'lovelace') {
            return { amount: amount, unit: '' };
          } else {
            return { amount: amount, unit: unit };
          }
        },
      ),
      metadata: input.metadata,
      network: input.network,
      blockchainIdentifier: input.blockchainIdentifier,
      paymentType: input.paymentType,
      contractAddress: smartContractAddress,
      sellerVkey: input.sellerVkey,
      submitResultTime: submitResultTime,
      unlockTime: unlockTime,
      externalDisputeUnlockTime: externalDisputeUnlockTime,
      inputHash: input.inputHash,
    });

    return {
      ...initialPurchaseRequest,
      PaidFunds: (
        initialPurchaseRequest.PaidFunds as Array<{
          unit: string;
          amount: bigint;
        }>
      ).map((amount) => ({
        ...amount,
        amount: amount.amount.toString(),
      })),
      WithdrawnForSeller: (
        initialPurchaseRequest.WithdrawnForSeller as Array<{
          unit: string;
          amount: bigint;
        }>
      ).map((amount) => ({
        ...amount,
        amount: amount.amount.toString(),
      })),
      WithdrawnForBuyer: (
        initialPurchaseRequest.WithdrawnForBuyer as Array<{
          unit: string;
          amount: bigint;
        }>
      ).map((amount) => ({
        ...amount,
        amount: amount.amount.toString(),
      })),
      submitResultTime: initialPurchaseRequest.submitResultTime.toString(),
      unlockTime: initialPurchaseRequest.unlockTime.toString(),
      externalDisputeUnlockTime:
        initialPurchaseRequest.externalDisputeUnlockTime.toString(),
    };
  },
});
