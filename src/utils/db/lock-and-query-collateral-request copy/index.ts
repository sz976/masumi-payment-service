import {
  CollateralRequest,
  CollateralRequestState,
  HotWallet,
  PaymentType,
  WalletSecret,
} from '@prisma/client';
import { prisma } from '../index.js';

export async function lockAndQueryCollateralRequests() {
  return await prisma.$transaction(
    async (prisma) => {
      const paymentSources = await prisma.paymentSource.findMany({
        where: {
          paymentType: PaymentType.Web3CardanoV1,
          syncInProgress: false,
          deletedAt: null,
        },
        include: {
          CollateralRequest: {
            where: {
              state: CollateralRequestState.Pending,
              HotWallet: {
                deletedAt: null,
                PendingTransaction: { is: null },
                lockedAt: null,
              },
            },
            include: {
              HotWallet: {
                include: {
                  Secret: true,
                },
              },
            },
          },
          AdminWallets: true,
          FeeReceiverNetworkWallet: true,
          PaymentSourceConfig: true,
        },
      });
      const collateralWallets: HotWallet[] = [];

      const newPaymentSources = [];
      for (const paymentSource of paymentSources) {
        const collateralRequests: Array<
          CollateralRequest & {
            HotWallet: HotWallet & { Secret: WalletSecret };
          }
        > = [];
        for (const collateralRequest of paymentSource.CollateralRequest) {
          const wallet = (
            collateralRequest as CollateralRequest & { HotWallet: HotWallet }
          ).HotWallet;
          if (
            wallet != null &&
            wallet.lockedAt == null &&
            !collateralWallets.some((w) => w.id === wallet.id)
          ) {
            const result = await prisma.hotWallet.update({
              where: { id: wallet.id, deletedAt: null },
              data: { lockedAt: new Date() },
            });
            wallet.pendingTransactionId = result.pendingTransactionId;
            collateralWallets.push(wallet);
            collateralRequests.push(
              collateralRequest as CollateralRequest & {
                HotWallet: HotWallet & { Secret: WalletSecret };
              },
            );
          }
        }
        if (collateralRequests.length > 0) {
          newPaymentSources.push({
            ...paymentSource,
            CollateralRequest: collateralRequests,
          });
        }
      }
      return newPaymentSources;
    },
    { isolationLevel: 'Serializable', timeout: 1000000 },
  );
}
