import { z } from 'zod';
import {
  Network,
  PaymentType,
  PurchasingAction,
  TransactionStatus,
  OnChainState,
  PurchaseErrorType,
  Permission,
  $Enums,
} from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { DEFAULTS } from '@/utils/config';
import { payAuthenticatedEndpointFactory } from '@/utils/security/auth/pay-authenticated';
import { checkIsAllowedNetworkOrThrowUnauthorized } from '@/utils/middleware/auth-middleware';

export const requestPurchaseRefundSchemaInput = z.object({
  blockchainIdentifier: z
    .string()
    .max(8000)
    .describe('The identifier of the purchase to be refunded'),
  network: z
    .nativeEnum(Network)
    .describe('The network the Cardano wallet will be used on'),
  smartContractAddress: z
    .string()
    .max(250)
    .optional()
    .describe('The address of the smart contract holding the purchase'),
});

export const requestPurchaseRefundSchemaOutput = z.object({
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
      id: z.string(),
      createdAt: z.date(),
      updatedAt: z.date(),
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

export const requestPurchaseRefundPost = payAuthenticatedEndpointFactory.build({
  method: 'post',
  input: requestPurchaseRefundSchemaInput,
  output: requestPurchaseRefundSchemaOutput,
  handler: async ({
    input,
    options,
  }: {
    input: z.infer<typeof requestPurchaseRefundSchemaInput>;
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
      include: {
        FeeReceiverNetworkWallet: true,
        AdminWallets: true,
        PaymentSourceConfig: true,
        PurchaseRequests: {
          where: {
            blockchainIdentifier: input.blockchainIdentifier,
            NextAction: {
              requestedAction: {
                in: [PurchasingAction.WaitingForExternalAction],
              },
            },
            onChainState: {
              in: [OnChainState.ResultSubmitted, OnChainState.FundsLocked],
            },
          },
          include: {
            SellerWallet: true,
            SmartContractWallet: { where: { deletedAt: null } },
            NextAction: true,
            CurrentTransaction: true,
            TransactionHistory: true,
            PaidFunds: true,
            PaymentSource: true,
          },
        },
      },
    });
    if (paymentSource == null) {
      throw createHttpError(
        404,
        'Network and Address combination not supported',
      );
    }
    if (paymentSource.PurchaseRequests.length == 0) {
      throw createHttpError(404, 'Purchase not found or not in valid state');
    }

    const purchase = paymentSource.PurchaseRequests[0];
    if (
      purchase.requestedById != options.id &&
      options.permission != Permission.Admin
    ) {
      throw createHttpError(
        403,
        'You are not authorized to request a refund for this purchase',
      );
    }
    if (purchase.CurrentTransaction == null) {
      throw createHttpError(400, 'Purchase in invalid state');
    }

    if (purchase.SmartContractWallet == null) {
      throw createHttpError(404, 'Smart contract wallet not set on purchase');
    }

    const result = await prisma.purchaseRequest.update({
      where: { id: purchase.id },
      data: {
        NextAction: {
          create: {
            requestedAction: PurchasingAction.SetRefundRequestedRequested,
            inputHash: purchase.inputHash,
          },
        },
      },
      include: {
        NextAction: true,
        CurrentTransaction: true,
        TransactionHistory: true,
        PaidFunds: true,
        PaymentSource: true,
        SellerWallet: true,
        SmartContractWallet: { where: { deletedAt: null } },
      },
    });
    return {
      ...result,
      submitResultTime: result.submitResultTime.toString(),
      unlockTime: result.unlockTime.toString(),
      externalDisputeUnlockTime: result.externalDisputeUnlockTime.toString(),
      PaidFunds: result.PaidFunds.map((amount) => ({
        ...amount,
        amount: amount.amount.toString(),
      })),
    };
  },
});
