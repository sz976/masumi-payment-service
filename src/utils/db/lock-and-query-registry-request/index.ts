import {
  HotWallet,
  HotWalletType,
  PaymentType,
  RegistrationState,
} from '@prisma/client';
import { prisma } from '../index.js';

export async function lockAndQueryRegistryRequests({
  state,
}: {
  state: RegistrationState;
}) {
  return await prisma.$transaction(
    async (prisma) => {
      const paymentSources = await prisma.paymentSource.findMany({
        where: {
          paymentType: PaymentType.Web3CardanoV1,
          syncInProgress: false,
        },
        include: {
          RegistryRequest: {
            where: {
              state: state,
            },
            include: {
              SmartContractWallet: {
                include: {
                  Secret: true,
                },
              },
              Pricing: {
                include: { FixedPricing: { include: { Amounts: true } } },
              },
            },
          },
          HotWallets: {
            include: {
              Secret: true,
            },
            where: {
              type: HotWalletType.Selling,
              PendingTransaction: null,
              lockedAt: null,
            },
          },
          AdminWallets: true,
          FeeReceiverNetworkWallet: true,
          PaymentSourceConfig: true,
        },
      });
      const sellingWallets: HotWallet[] = [];

      const newPaymentSources = [];
      for (const paymentSource of paymentSources) {
        const registryRequests = [];
        for (const registryRequest of paymentSource.RegistryRequest) {
          const wallet = registryRequest.SmartContractWallet;
          if (
            wallet != null &&
            wallet.lockedAt == null &&
            !sellingWallets.some((w) => w.id === wallet.id)
          ) {
            const result = await prisma.hotWallet.update({
              where: { id: wallet.id },
              data: { lockedAt: new Date() },
            });
            wallet.pendingTransactionId = result.pendingTransactionId;
            sellingWallets.push(wallet);
            registryRequests.push(registryRequest);
          }
        }
        if (registryRequests.length > 0) {
          newPaymentSources.push({
            ...paymentSource,
            RegistryRequest: registryRequests,
          });
        }
      }
      return newPaymentSources;
    },
    { isolationLevel: 'Serializable', timeout: 1000000 },
  );
}
