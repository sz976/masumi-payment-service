import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { useAppContext } from '@/lib/contexts/AppContext';
import { postPaymentSourceExtended } from '@/lib/api/generated';
import { toast } from 'react-toastify';
import { X, Copy, Check } from 'lucide-react';
import { shortenAddress, copyToClipboard } from '@/lib/utils';
import {
  DEFAULT_ADMIN_WALLETS,
  DEFAULT_FEE_CONFIG,
} from '@/lib/constants/defaultWallets';

interface AddPaymentSourceDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type FormData = {
  network: 'Mainnet' | 'Preprod';
  paymentType: 'Web3CardanoV1';
  blockfrostApiKey: string;
  feeReceiverWallet: { walletAddress: string };
  feePermille: number | null;
  purchasingWallets: {
    walletMnemonic: string;
    note?: string;
    collectionAddress?: string;
  }[];
  sellingWallets: {
    walletMnemonic: string;
    note?: string;
    collectionAddress?: string;
  }[];
  useCustomAdminWallets: boolean;
  customAdminWallets: { walletAddress: string }[];
};

export function AddPaymentSourceDialog({
  open,
  onClose,
  onSuccess,
}: AddPaymentSourceDialogProps) {
  const { apiClient, state } = useAppContext();
  const [formData, setFormData] = useState<FormData>({
    network: state.network,
    paymentType: 'Web3CardanoV1',
    blockfrostApiKey: '',
    feeReceiverWallet: {
      walletAddress: DEFAULT_FEE_CONFIG[state.network].feeWalletAddress,
    },
    feePermille: DEFAULT_FEE_CONFIG[state.network].feePermille,
    purchasingWallets: [
      { walletMnemonic: '', note: '', collectionAddress: '' },
    ],
    sellingWallets: [{ walletMnemonic: '', note: '', collectionAddress: '' }],
    useCustomAdminWallets: false,
    customAdminWallets: [
      { walletAddress: '' },
      { walletAddress: '' },
      { walletAddress: '' },
    ],
  });

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      network: state.network,
      feeReceiverWallet: {
        walletAddress: DEFAULT_FEE_CONFIG[state.network].feeWalletAddress,
      },
      feePermille: DEFAULT_FEE_CONFIG[state.network].feePermille,
    }));
  }, [state.network]);

  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  // Add state to track which addresses have been copied
  const [copiedAddresses, setCopiedAddresses] = useState<{
    [key: string]: boolean;
  }>({});

  // Handle copy with visual feedback
  const handleCopy = async (address: string) => {
    await copyToClipboard(address);
    setCopiedAddresses({ ...copiedAddresses, [address]: true });
    setTimeout(() => {
      setCopiedAddresses((prev) => ({ ...prev, [address]: false }));
    }, 2000);
  };

  const handleSubmit = async () => {
    setError('');
    setIsLoading(true);

    try {
      if (!formData.blockfrostApiKey.trim()) {
        setError('Blockfrost API key is required');
        return;
      }

      if (!formData.feeReceiverWallet.walletAddress.trim()) {
        setError('Fee receiver wallet is required');
        return;
      }

      // Use either custom admin wallets or default ones
      const adminWallets = formData.useCustomAdminWallets
        ? (formData.customAdminWallets as [
            { walletAddress: string },
            { walletAddress: string },
            { walletAddress: string },
          ])
        : DEFAULT_ADMIN_WALLETS[formData.network];

      // Validate custom admin wallets if being used
      if (formData.useCustomAdminWallets) {
        if (formData.customAdminWallets.length !== 3) {
          setError('Exactly 3 admin wallet addresses are required');
          return;
        }
        const emptyWallets = formData.customAdminWallets.filter(
          (w) => !w.walletAddress.trim(),
        );
        if (emptyWallets.length > 0) {
          setError('All custom admin wallet addresses are required');
          return;
        }
      }

      await postPaymentSourceExtended({
        client: apiClient,
        body: {
          network: formData.network,
          paymentType: formData.paymentType,
          PaymentSourceConfig: {
            rpcProviderApiKey: formData.blockfrostApiKey,
            rpcProvider: 'Blockfrost',
          },
          feeRatePermille: formData.feePermille,
          AdminWallets: adminWallets,
          FeeReceiverNetworkWallet: formData.feeReceiverWallet,
          PurchasingWallets: formData.purchasingWallets
            .filter((w) => w.walletMnemonic.trim())
            .map((w) => ({
              walletMnemonic: w.walletMnemonic,
              collectionAddress: w.collectionAddress?.trim() || null,
              note: w.note || '',
            })),
          SellingWallets: formData.sellingWallets
            .filter((w) => w.walletMnemonic.trim())
            .map((w) => ({
              walletMnemonic: w.walletMnemonic,
              collectionAddress: w.collectionAddress?.trim() || null,
              note: w.note || '',
            })),
        },
      });

      toast.success('Payment source created successfully');
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error creating payment source:', error);
      setError(
        error instanceof Error
          ? error.message
          : 'Failed to create payment source',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const addPurchasingWallet = () => {
    setFormData({
      ...formData,
      purchasingWallets: [
        ...formData.purchasingWallets,
        { walletMnemonic: '', note: '', collectionAddress: '' },
      ],
    });
  };

  const addSellingWallet = () => {
    setFormData({
      ...formData,
      sellingWallets: [
        ...formData.sellingWallets,
        { walletMnemonic: '', note: '', collectionAddress: '' },
      ],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Payment Source</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {error && <div className="text-sm text-destructive">{error}</div>}

          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Basic Configuration</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Network <span className="text-destructive">*</span>
                </label>
                <select
                  className="w-full p-2 rounded-md bg-background border"
                  value={formData.network}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      network: e.target.value as 'Mainnet' | 'Preprod',
                    })
                  }
                >
                  <option value="Preprod">Preprod</option>
                  <option value="Mainnet">Mainnet</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Blockfrost API Key <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  className="w-full p-2 rounded-md bg-background border"
                  value={formData.blockfrostApiKey}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      blockfrostApiKey: e.target.value,
                    })
                  }
                  placeholder="Using default Blockfrost API key"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Fee Permille <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  className="w-full p-2 rounded-md bg-background border"
                  value={formData.feePermille || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      feePermille: parseInt(e.target.value) || null,
                    })
                  }
                  min="0"
                  max="1000"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Fee Receiver Wallet</h3>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Wallet Address <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                className="w-full p-2 rounded-md bg-background border"
                value={formData.feeReceiverWallet.walletAddress}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    feeReceiverWallet: { walletAddress: e.target.value },
                  })
                }
                placeholder="Enter fee receiver wallet address"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Admin Wallets</h3>
              <div className="flex items-center gap-2">
                <label className="text-sm">Use Custom Admin Wallets</label>
                <input
                  type="checkbox"
                  checked={formData.useCustomAdminWallets}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      useCustomAdminWallets: e.target.checked,
                    })
                  }
                />
              </div>
            </div>

            {formData.useCustomAdminWallets ? (
              <div className="space-y-4">
                {formData.customAdminWallets.map((wallet, index) => (
                  <div key={index} className="space-y-2">
                    <label className="text-sm font-medium">
                      Admin Wallet {index + 1}{' '}
                      <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      className="w-full p-2 rounded-md bg-background border"
                      value={wallet.walletAddress}
                      onChange={(e) => {
                        const newWallets = [...formData.customAdminWallets];
                        newWallets[index].walletAddress = e.target.value;
                        setFormData({
                          ...formData,
                          customAdminWallets: newWallets,
                        });
                      }}
                      placeholder={`Enter admin wallet ${index + 1} address`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Using default admin wallets for {formData.network}:
                </p>
                {DEFAULT_ADMIN_WALLETS[formData.network].map(
                  (wallet, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between text-sm font-mono bg-muted p-2 rounded"
                    >
                      <div className="flex flex-col">
                        <span>{shortenAddress(wallet.walletAddress)}</span>
                        {wallet.note && (
                          <span className="text-xs text-muted-foreground">
                            {wallet.note}
                          </span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleCopy(wallet.walletAddress)}
                      >
                        {copiedAddresses[wallet.walletAddress] ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Purchasing Wallets</h3>
              <Button
                type="button"
                variant="secondary"
                onClick={addPurchasingWallet}
              >
                Add Purchasing Wallet
              </Button>
            </div>

            {formData.purchasingWallets.map((wallet, index) => (
              <div key={index} className="space-y-2 relative">
                <div className="text-sm font-medium flex items-center justify-start space-x-2">
                  <span>Purchasing Wallet {index + 1}</span>
                  {index > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        const newWallets = formData.purchasingWallets.filter(
                          (_, i) => i !== index,
                        );
                        setFormData({
                          ...formData,
                          purchasingWallets: newWallets,
                        });
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    className="w-full p-2 rounded-md bg-background border"
                    value={wallet.walletMnemonic}
                    onChange={(e) => {
                      const newWallets = [...formData.purchasingWallets];
                      newWallets[index].walletMnemonic = e.target.value;
                      setFormData({
                        ...formData,
                        purchasingWallets: newWallets,
                      });
                    }}
                    placeholder="Enter wallet mnemonic"
                  />
                </div>
                <input
                  type="text"
                  className="w-full p-2 rounded-md bg-background border"
                  value={wallet.note || ''}
                  onChange={(e) => {
                    const newWallets = [...formData.purchasingWallets];
                    newWallets[index].note = e.target.value;
                    setFormData({ ...formData, purchasingWallets: newWallets });
                  }}
                  placeholder="Note (optional)"
                />
                <input
                  type="text"
                  className="w-full p-2 rounded-md bg-background border"
                  value={wallet.collectionAddress || ''}
                  onChange={(e) => {
                    const newWallets = [...formData.purchasingWallets];
                    newWallets[index].collectionAddress = e.target.value;
                    setFormData({ ...formData, purchasingWallets: newWallets });
                  }}
                  placeholder="Collection Address (optional)"
                />
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Selling Wallets</h3>
              <Button
                type="button"
                variant="secondary"
                onClick={addSellingWallet}
              >
                Add Selling Wallet
              </Button>
            </div>

            {formData.sellingWallets.map((wallet, index) => (
              <div key={index} className="space-y-2 relative">
                <div className="text-sm font-medium flex items-center justify-start space-x-2">
                  <span>Selling Wallet {index + 1}</span>
                  {index > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        const newWallets = formData.sellingWallets.filter(
                          (_, i) => i !== index,
                        );
                        setFormData({
                          ...formData,
                          sellingWallets: newWallets,
                        });
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    className="w-full p-2 rounded-md bg-background border"
                    value={wallet.walletMnemonic}
                    onChange={(e) => {
                      const newWallets = [...formData.sellingWallets];
                      newWallets[index].walletMnemonic = e.target.value;
                      setFormData({ ...formData, sellingWallets: newWallets });
                    }}
                    placeholder="Enter wallet mnemonic"
                  />
                </div>
                <input
                  type="text"
                  className="w-full p-2 rounded-md bg-background border"
                  value={wallet.note || ''}
                  onChange={(e) => {
                    const newWallets = [...formData.sellingWallets];
                    newWallets[index].note = e.target.value;
                    setFormData({ ...formData, sellingWallets: newWallets });
                  }}
                  placeholder="Note (optional)"
                />
                <input
                  type="text"
                  className="w-full p-2 rounded-md bg-background border"
                  value={wallet.collectionAddress || ''}
                  onChange={(e) => {
                    const newWallets = [...formData.sellingWallets];
                    newWallets[index].collectionAddress = e.target.value;
                    setFormData({ ...formData, sellingWallets: newWallets });
                  }}
                  placeholder="Collection Address (optional)"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create Payment Source'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
