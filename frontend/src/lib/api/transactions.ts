import { apiClient } from './client';
import type { BaseTransactionQuery } from '@/types/api';

export interface Transaction {
  type: 'payment' | 'purchase';
  createdAt: string;
  updatedAt: string;
  status: string;
  txHash?: string;
  utxo?: string;
  errorType?: string;
  errorNote?: string;
  errorRequiresManualReview?: boolean;
  identifier: string;
  sellingWallet: {
    walletAddress: string;
    note?: string;
  };
  collectionWallet: {
    walletAddress: string;
    note?: string;
  };
  buyerWallet: {
    walletAddress: string;
    note?: string;
  };
  amounts: {
    amount: number;
    unit: string;
  }[];
  networkHandler: {
    network: string;
    paymentType: string;
  };
  checkedBy: {
    network: string;
    paymentType: string;
  };
}

const api : any = apiClient

export async function getTransactions(token: string, params: BaseTransactionQuery = {}) {
  if (!token) {
    throw new Error('Authorization token is required');
  }

  try {
    const response = await api?.transactions?.transactionsList({
      ...params,
      limit: params.limit || 10
    });

    return {
      status: 'success',
      data: response.data
    };
  } catch (error) {
    console.error('Error fetching transactions:', error);
    throw error;
  }
} 