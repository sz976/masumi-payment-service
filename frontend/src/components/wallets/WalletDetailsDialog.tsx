/* eslint-disable react-hooks/rules-of-hooks */
import { Button } from '@/components/ui/button';
import { Copy, RefreshCw } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAppContext } from '@/lib/contexts/AppContext';
import { getUtxos } from '@/lib/api/generated';
import { toast } from 'react-toastify';
import { shortenAddress } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import useFormatBalance from '@/lib/hooks/useFormatBalance';
import { useRate } from '@/lib/hooks/useRate';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface TokenBalance {
  unit: string;
  policyId: string;
  assetName: string;
  quantity: number;
  displayName: string;
}

export interface WalletWithBalance {
  id: string;
  walletVkey: string;
  walletAddress: string;
  collectionAddress: string | null;
  note: string | null;
  type: 'Purchasing' | 'Selling';
  balance: string;
  usdmBalance: string;
}

interface WalletDetailsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: WalletWithBalance | null;
}

export function WalletDetailsDialog({
  isOpen,
  onClose,
  wallet,
}: WalletDetailsDialogProps) {
  const { apiClient, state } = useAppContext();
  const [isLoading, setIsLoading] = useState(true);
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { rate } = useRate();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Address copied to clipboard');
  };

  const fetchTokenBalances = async () => {
    if (!wallet) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await getUtxos({
        client: apiClient,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
        query: {
          address: wallet.walletAddress,
          network: state.network,
        },
      });

      if (response.data?.data?.Utxos) {
        const balanceMap = new Map<string, number>();

        response.data.data.Utxos.forEach((utxo) => {
          utxo.Amounts.forEach((amount) => {
            const currentAmount = balanceMap.get(amount.unit) || 0;
            balanceMap.set(amount.unit, currentAmount + (amount.quantity || 0));
          });
        });

        const tokens: TokenBalance[] = [];
        balanceMap.forEach((quantity, unit) => {
          if (unit === 'lovelace' || unit === '') {
            tokens.push({
              unit: 'lovelace',
              policyId: '',
              assetName: 'ADA',
              quantity,
              displayName: 'ADA',
            });
          } else {
            // For other tokens, split into policy ID and asset name
            const policyId = unit.slice(0, 56);
            const assetNameHex = unit.slice(56);
            const assetName = hexToAscii(assetNameHex);

            tokens.push({
              unit,
              policyId,
              assetName,
              quantity,
              displayName: assetName || unit,
            });
          }
        });

        setTokenBalances(tokens);
      }
    } catch (error) {
      console.error('Failed to fetch token balances:', error);
      setError('Failed to fetch token balances');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && wallet) {
      fetchTokenBalances();
    }
  }, [isOpen, wallet?.walletAddress]);

  const hexToAscii = (hex: string) => {
    try {
      const bytes =
        hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [];
      return bytes.map((byte) => String.fromCharCode(byte)).join('');
    } catch {
      return hex;
    }
  };

  const formatTokenBalance = (token: TokenBalance) => {
    if (token.unit === 'lovelace') {
      const ada = token.quantity / 1000000;
      return {
        amount: useFormatBalance(ada.toFixed(6)),
        usdValue: rate ? `≈ $${(ada * rate).toFixed(2)}` : undefined,
      };
    }

    // For USDM, divide by 10^7
    if (token.displayName === 'USDM') {
      const usdm = token.quantity / 10000000;
      return {
        amount: useFormatBalance(usdm.toFixed(6)),
        usdValue: `≈ $${usdm.toFixed(2)}`,
      };
    }

    // For other tokens, divide by 10^6 as a default
    const amount = token.quantity / 1000000;
    return {
      amount: useFormatBalance(amount.toFixed(6)),
      usdValue: undefined,
    };
  };

  if (!wallet) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Wallet Details</DialogTitle>
          <DialogDescription>
            {wallet.type} Wallet
            {wallet.note && ` - ${wallet.note}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium">Wallet Address</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">
                  {shortenAddress(wallet.walletAddress)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => copyToClipboard(wallet.walletAddress)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={fetchTokenBalances}
              disabled={isLoading}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Token Balances</div>
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner size={20} />
              </div>
            ) : error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : (
              <div className="space-y-2">
                {tokenBalances.map((token) => {
                  const { amount, usdValue } = formatTokenBalance(token);
                  return (
                    <div
                      key={token.unit}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div>
                        <div className="font-medium">{token.displayName}</div>
                        {token.policyId && (
                          <div className="text-xs text-muted-foreground">
                            Policy ID: {shortenAddress(token.policyId)}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div>{amount}</div>
                        {usdValue && (
                          <div className="text-xs text-muted-foreground">
                            {usdValue}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
