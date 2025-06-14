import { payAuthenticatedEndpointFactory } from '@/utils/security/auth/pay-authenticated';
import { z } from 'zod';
import {
  $Enums,
  CollateralRequestState,
  HotWalletType,
  Network,
  TransactionStatus,
} from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { DEFAULTS } from '@/utils/config';
import { checkIsAllowedNetworkOrThrowUnauthorized } from '@/utils/middleware/auth-middleware';

export const queryCollateralRequestSchemaInput = z.object({
  cursorId: z
    .string()
    .optional()
    .describe('The cursor id to paginate through the results'),
  network: z
    .nativeEnum(Network)
    .describe('The Cardano network used to register the agent on'),
  smartContractAddress: z
    .string()
    .max(250)
    .optional()
    .describe(
      'The smart contract address of the payment source to which the registration belongs',
    ),
});

export const queryCollateralRequestSchemaOutput = z.object({
  CollateralRequests: z.array(
    z.object({
      id: z.string(),
      state: z.nativeEnum(CollateralRequestState),
      HotWallet: z.object({
        id: z.string(),
        walletAddress: z.string(),
        walletVkey: z.string(),
        type: z.nativeEnum(HotWalletType),
      }),
      Transaction: z
        .object({
          txHash: z.string(),
          status: z.nativeEnum(TransactionStatus),
        })
        .nullable(),
    }),
  ),
});

export const queryCollateralRequestGet = payAuthenticatedEndpointFactory.build({
  method: 'get',
  input: queryCollateralRequestSchemaInput,
  output: queryCollateralRequestSchemaOutput,
  handler: async ({
    input,
    options,
  }: {
    input: z.infer<typeof queryCollateralRequestSchemaInput>;
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
        PaymentSourceConfig: true,
        HotWallets: { where: { deletedAt: null } },
      },
    });
    if (paymentSource == null) {
      throw createHttpError(
        404,
        'Network and Address combination not supported',
      );
    }

    const result = await prisma.collateralRequest.findMany({
      where: {
        PaymentSource: {
          id: paymentSource.id,
        },
        HotWallet: { deletedAt: null },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
      cursor: input.cursorId ? { id: input.cursorId } : undefined,
      include: {
        HotWallet: true,
        Transaction: true,
      },
    });

    return {
      CollateralRequests: result.map((item) => ({
        ...item,
        HotWallet: {
          id: item.HotWallet.id,
          walletAddress: item.HotWallet.walletAddress,
          type: item.HotWallet.type,
          walletVkey: item.HotWallet.walletVkey,
        },
        Transaction: item.Transaction
          ? {
              txHash: item.Transaction.txHash,
              status: item.Transaction.status,
            }
          : null,
      })),
    };
  },
});

export const postCollateralSchemaInput = z.object({
  network: z
    .nativeEnum(Network)
    .describe('The Cardano network used to register the collateral on'),
  smartContractAddress: z
    .string()
    .max(250)
    .optional()
    .describe(
      'The smart contract address of the payment source to be registered for',
    ),
  sellingWalletVkey: z
    .string()
    .max(250)
    .describe('The payment key of a specific wallet used for the collateral'),
});

export const postCollateralSchemaOutput = z.object({
  id: z.string(),
  state: z.nativeEnum(CollateralRequestState),
  HotWallet: z.object({
    id: z.string(),
    walletAddress: z.string(),
    type: z.nativeEnum(HotWalletType),
    walletVkey: z.string(),
  }),
  Transaction: z.object({
    txHash: z.string(),
    status: z.nativeEnum(TransactionStatus),
  }),
});

export const postCollateralPost = payAuthenticatedEndpointFactory.build({
  method: 'post',
  input: postCollateralSchemaInput,
  output: postCollateralSchemaOutput,
  handler: async ({
    input,
    options,
  }: {
    input: z.infer<typeof postCollateralSchemaInput>;
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
        AdminWallets: true,
        HotWallets: { include: { Secret: true }, where: { deletedAt: null } },
        PaymentSourceConfig: true,
      },
    });
    if (paymentSource == null) {
      throw createHttpError(
        404,
        'Network and Address combination not supported',
      );
    }
    await checkIsAllowedNetworkOrThrowUnauthorized(
      options.networkLimit,
      input.network,
      options.permission,
    );

    const sellingWallet = paymentSource.HotWallets.find(
      (wallet) =>
        wallet.walletVkey == input.sellingWalletVkey &&
        wallet.type == HotWalletType.Selling,
    );
    if (sellingWallet == null) {
      throw createHttpError(404, 'Selling wallet not found');
    }
    const result = await prisma.collateralRequest.create({
      data: {
        state: CollateralRequestState.Pending,
        HotWallet: {
          connect: {
            id: sellingWallet.id,
          },
        },
        PaymentSource: {
          connect: {
            id: paymentSource.id,
          },
        },
      },
      include: {
        HotWallet: true,
        Transaction: true,
      },
    });

    return {
      ...result,
      HotWallet: {
        id: result.HotWallet.id,
        walletAddress: result.HotWallet.walletAddress,
        type: result.HotWallet.type,
        walletVkey: result.HotWallet.walletVkey,
      },
      Transaction: {
        txHash: result.Transaction?.txHash ?? '',
        status: result.Transaction?.status ?? TransactionStatus.Pending,
      },
    };
  },
});
