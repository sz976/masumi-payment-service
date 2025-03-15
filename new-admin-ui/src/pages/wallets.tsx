/* eslint-disable react-hooks/exhaustive-deps */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MainLayout } from "@/components/layout/MainLayout";
import { Plus, ChevronDown, Settings, Copy, RefreshCw, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { AddWalletDialog } from "@/components/wallets/AddWalletDialog";
import Link from "next/link";
import { useAppContext } from "@/lib/contexts/AppContext";
import { getPaymentSource, getUtxos } from "@/lib/api/generated";
import { toast } from "react-toastify";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import Head from "next/head";
import { useRate } from "@/lib/hooks/useRate";
import { Spinner } from "@/components/ui/spinner";
import { TransakWidget } from "@/components/wallets/TransakWidget";

interface Wallet {
  id: string;
  walletVkey: string;
  walletAddress: string;
  collectionAddress: string | null;
  note: string | null;
  type: 'buying' | 'selling';
  balance?: string;
}

interface UTXO {
  txHash: string;
  address: string;
  Amounts: Array<{
    unit: string;
    quantity: number | null;
  }>;
  dataHash: string | null;
  inlineDatum: string | null;
  referenceScriptHash: string | null;
  outputIndex: number | null;
  block: string;
}

export default function WalletsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedWallets, setSelectedWallets] = useState<string[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { apiClient } = useAppContext();
  const { rate, isLoading: isLoadingRate } = useRate();
  const [selectedWalletForTopup, setSelectedWalletForTopup] = useState<Wallet | null>(null);

  const fetchWalletBalance = async (wallet: Wallet) => {
    try {
      const response = await getUtxos({
        client: apiClient,
        query: {
          address: wallet.walletAddress,
          network: 'Preprod',
        }
      });

      if (response.data?.data?.Utxos) {
        const balance = response.data.data.Utxos.reduce((sum: number, utxo: UTXO) => {
          const adaAmount = utxo.Amounts[0]?.quantity || 0;
          return sum + (adaAmount || 0);
        }, 0);
        return balance.toString();
      }
      return "0";
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
      return "0";
    }
  };

  const fetchWallets = async () => {
    try {
      setIsLoading(true);
      const response = await getPaymentSource({
        client: apiClient
      });

      if (response.data?.data?.PaymentSources) {
        const paymentSource = response.data.data.PaymentSources[0];
        if (paymentSource) {
          const allWallets: Wallet[] = [
            ...paymentSource.PurchasingWallets.map(wallet => ({
              ...wallet,
              type: 'buying' as const
            })),
            ...paymentSource.SellingWallets.map(wallet => ({
              ...wallet,
              type: 'selling' as const
            }))
          ];

          const walletsWithBalances = await Promise.all(
            allWallets.map(async (wallet) => {
              const balance = await fetchWalletBalance(wallet);
              return { ...wallet, balance };
            })
          );

          setWallets(walletsWithBalances);
        }
      }
    } catch (error) {
      console.error('Error fetching wallets:', error);
      toast.error('Failed to load wallets');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets();
  }, []);

  const handleSelectWallet = (id: string) => {
    setSelectedWallets(prev => 
      prev.includes(id) 
        ? prev.filter(walletId => walletId !== id)
        : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (wallets.length === 0) {
      setSelectedWallets([]);
      return;
    }

    if (selectedWallets.length === wallets.length) {
      setSelectedWallets([]);
    } else {
      setSelectedWallets(wallets.map(wallet => wallet.id));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Address copied to clipboard');
  };

  const refreshWalletBalance = async (wallet: Wallet) => {
    try {
      const balance = await fetchWalletBalance(wallet);
      setWallets(prev => prev.map(w => 
        w.id === wallet.id ? { ...w, balance } : w
      ));
    } catch (error) {
      console.error('Error refreshing wallet balance:', error);
    }
  };

  const formatUsdValue = (adaAmount: string) => {
    if (!rate || !adaAmount) return '—';
    const ada = parseInt(adaAmount) / 1000000;
    return `≈ $${(ada * rate).toFixed(2)}`;
  };

  return (
    <MainLayout>
      <Head>
        <title>Wallets | Admin Interface</title>
      </Head>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Wallets</h1>
            <p className="text-sm text-muted-foreground">
              Manage your buying and selling wallets.{' '}
              <Link href="#" className="text-primary hover:underline">
                Learn more
              </Link>
            </p>
          </div>
          <Button 
            className="flex items-center gap-2 bg-black text-white hover:bg-black/90"
            onClick={() => setIsAddDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add wallet
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search wallet"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-xs pl-10"
            />
          </div>
          <Button variant="outline" className="flex items-center gap-2">
            Filters
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-10 w-10">
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        <div className="rounded-lg border">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="w-12 p-4">
                  <Checkbox 
                    checked={wallets.length > 0 && selectedWallets.length === wallets.length}
                    onCheckedChange={handleSelectAll}
                  />
                </th>
                <th className="p-4 text-left text-sm font-medium">Type</th>
                <th className="p-4 text-left text-sm font-medium">Name</th>
                <th className="p-4 text-left text-sm font-medium">Address</th>
                <th className="p-4 text-left text-sm font-medium">Linked AI agents</th>
                <th className="p-4 text-left text-sm font-medium">Balance, ADA</th>
                <th className="w-20 p-4"></th>
                <th className="w-20 p-4"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8}>
                    <Spinner size={20} addContainer />
                  </td>
                </tr>
              ) : wallets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8">
                    No wallets found
                  </td>
                </tr>
              ) : (
                wallets.map((wallet) => (
                  <tr key={wallet.id} className="border-b last:border-b-0">
                    <td className="p-4">
                      <Checkbox
                        checked={selectedWallets.includes(wallet.id)}
                        onCheckedChange={() => handleSelectWallet(wallet.id)}
                      />
                    </td>
                    <td className="p-4">
                        <div>
                          <span className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full",
                            wallet.type === 'buying'
                              ? "bg-primary text-primary-foreground"
                              : "bg-orange-50 dark:bg-[#f002] text-orange-600 dark:text-orange-400"
                          )}>
                            {wallet.type === 'buying' ? 'Buying' : 'Selling'}
                          </span>
                        </div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm">{wallet.type === 'buying' ? 'Buying wallet' : 'Selling wallet'}</div>
                      <div className="text-xs text-muted-foreground">{wallet.note || 'No description'}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                          {wallet.walletAddress}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-4 w-4"
                          onClick={() => copyToClipboard(wallet.walletAddress)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                    <td className="p-4 text-sm">—</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {!isLoadingRate ? <div className="flex flex-col items-center gap-2">
                          <div className="text-sm">{wallet.balance ? `${(parseInt(wallet.balance) / 1000000).toFixed(2)}` : '—'}</div>
                          {wallet.balance && <div className="text-xs text-muted-foreground">
                            {formatUsdValue(wallet.balance || '0')}
                          </div>}
                        </div> : <Spinner size={16} />}
                        {isLoading ? (
                          <Spinner size={16} />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => refreshWalletBalance(wallet)}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWalletForTopup(wallet);
                        }}
                      >
                        Top up
                      </Button>
                    </td>
                    <td className="p-4">
                      <Button variant="ghost" size="sm">•••</Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-[#f002] dark:border-orange-500/20 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <div className="text-sm">
                We recommend to add your own wallet to collect funds.{' '}
                <Link href="#" className="text-orange-600 dark:text-orange-400 hover:underline">
                  Learn more
                </Link>
              </div>
            </div>
            <Button variant="outline" className="border-orange-600 text-orange-600 dark:border-orange-400 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-500/10">
              Add collecting wallet
            </Button>
          </div>
        </div>
      </div>

      <AddWalletDialog
        open={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={fetchWallets}
      />

      <TransakWidget
        isOpen={!!selectedWalletForTopup}
        onClose={() => setSelectedWalletForTopup(null)}
        walletAddress={selectedWalletForTopup?.walletAddress || ''}
        onSuccess={() => {
          toast.success('Top up successful');
          refreshWalletBalance(selectedWalletForTopup!);
        }}
      />
    </MainLayout>
  );
} 