import {
  HotWallet,
  OnChainState,
  PaymentType,
  PurchasingAction,
} from '@prisma/client';
import { prisma } from '..';
import { logger } from '@/utils/logger';

export async function lockAndQueryPurchases({
  purchasingAction,
  unlockTime,
  onChainState = undefined,
  requestedResultHash = undefined,
  submitResultTime = undefined,
}: {
  purchasingAction: PurchasingAction;
  unlockTime?: { lte: number } | undefined | { gte: number };
  onChainState?: OnChainState | { in: OnChainState[] } | undefined;
  requestedResultHash?: string | undefined;
  submitResultTime?: { lte: number } | undefined | { gte: number };
}) {
  return await prisma.$transaction(
    async (prisma) => {
      try {
        const minCooldownTime = Date.now() - 1000 * 60 * 3;
        const paymentSources = await prisma.paymentSource.findMany({
          where: {
            paymentType: PaymentType.Web3CardanoV1,
            syncInProgress: false,
          },
          include: {
            PurchaseRequests: {
              where: {
                submitResultTime: submitResultTime,
                unlockTime: unlockTime,
                NextAction: {
                  requestedAction: purchasingAction,
                  errorType: null,
                },
                resultHash: requestedResultHash,
                onChainState: onChainState,
                SmartContractWallet: {
                  PendingTransaction: { is: null },
                  lockedAt: null,
                },
                //we only want to lock the purchase if the cooldown time has passed
                buyerCoolDownTime: { lte: minCooldownTime },
              },
              include: {
                NextAction: true,
                CurrentTransaction: true,
                PaidFunds: true,
                SellerWallet: true,
                SmartContractWallet: {
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
        const purchasingWallets: HotWallet[] = [];
        const newPaymentSources = [];
        for (const paymentSource of paymentSources) {
          const purchasingRequests = [];
          const minCooldownTime = paymentSource.cooldownTime;
          for (const purchasingRequest of paymentSource.PurchaseRequests) {
            if (
              purchasingRequest.buyerCoolDownTime >
              Date.now() - minCooldownTime
            ) {
              continue;
            }
            const wallet = purchasingRequest.SmartContractWallet;
            if (
              wallet != null &&
              !purchasingWallets.some((w) => w.id === wallet.id)
            ) {
              const result = await prisma.hotWallet.update({
                where: { id: wallet.id },
                data: { lockedAt: new Date() },
              });
              wallet.pendingTransactionId = result.pendingTransactionId;
              purchasingWallets.push(wallet);
              purchasingRequests.push(purchasingRequest);
            }
          }
          if (purchasingRequests.length > 0) {
            newPaymentSources.push({
              ...paymentSource,
              PurchaseRequests: purchasingRequests,
            });
          }
        }
        return newPaymentSources;
      } catch (error) {
        logger.error('Error locking and querying purchases', error);
        throw error;
      }
    },
    { isolationLevel: 'Serializable' },
  );
}
