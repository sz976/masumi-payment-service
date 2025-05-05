import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState, useEffect } from 'react';
import { useAppContext } from '@/lib/contexts/AppContext';
import { postApiKey } from '@/lib/api/generated';
import { toast } from 'react-toastify';
import { Checkbox } from '@/components/ui/checkbox';

interface AddApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Network = 'Preprod' | 'Mainnet';

export function AddApiKeyDialog({
  open,
  onClose,
  onSuccess,
}: AddApiKeyDialogProps) {
  const [permission, setPermission] = useState<'Read' | 'ReadAndPay' | 'Admin'>(
    'Read',
  );
  const [usageLimited, setUsageLimited] = useState(true);
  const [networks, setNetworks] = useState<('Preprod' | 'Mainnet')[]>([
    'Preprod',
    'Mainnet',
  ]);
  const [credits, setCredits] = useState<{ lovelace: string; usdm: string }>({
    lovelace: '',
    usdm: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const { apiClient } = useAppContext();

  const handleNetworkToggle = (network: Network) => {
    setNetworks((prev) =>
      prev.includes(network)
        ? prev.filter((n) => n !== network)
        : [...prev, network],
    );
  };

  const validateForm = () => {
    if (permission === 'Admin') {
      return true;
    }

    if (permission === 'Read') {
      return true; // Read permission uses default limits
    }

    // Enforce usage limits for ReadAndPay
    if (
      permission === 'ReadAndPay' &&
      usageLimited &&
      !credits.lovelace &&
      !credits.usdm
    ) {
      toast.error('Please specify usage credits for Read and Pay permission');
      return false;
    }

    return true;
  };

  // Update usageLimited when permission changes
  useEffect(() => {
    if (permission === 'Admin') {
      setUsageLimited(false);
    } else if (permission === 'Read') {
      setUsageLimited(true);
    }
  }, [permission]);

  const handleSubmit = async () => {
    if (!validateForm()) return;

    try {
      setIsLoading(true);

      // Set default values for read-only operations
      const isReadOnly = permission === 'Read';
      const defaultCredits = [
        {
          unit: 'lovelace',
          amount: '1000000000', // 1000 ADA
        },
      ];

      await postApiKey({
        client: apiClient,
        body: {
          permission,
          usageLimited: isReadOnly ? 'true' : usageLimited.toString(),
          networkLimit: networks,
          UsageCredits: isReadOnly
            ? defaultCredits
            : usageLimited
              ? [
                  ...(credits.lovelace
                    ? [
                        {
                          unit: 'lovelace',
                          amount: (
                            parseFloat(credits.lovelace) * 1000000
                          ).toString(),
                        },
                      ]
                    : []),
                  ...(credits.usdm
                    ? [
                        {
                          unit: 'usdm',
                          amount: credits.usdm,
                        },
                      ]
                    : []),
                ]
              : [],
        },
      });

      toast.success('API key created successfully');
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error creating API key:', error);
      toast.error('Failed to create API key');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setPermission('Read');
    setUsageLimited(true);
    setNetworks(['Preprod', 'Mainnet']);
    setCredits({ lovelace: '', usdm: '' });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add API key</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Permission</label>
            <Select
              value={permission}
              onValueChange={(value: 'Read' | 'ReadAndPay' | 'Admin') =>
                setPermission(value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Read">Read</SelectItem>
                <SelectItem value="ReadAndPay">Read and Pay</SelectItem>
                <SelectItem value="Admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Networks</label>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={networks.includes('Preprod')}
                  onCheckedChange={() => handleNetworkToggle('Preprod')}
                />
                <label className="text-sm">Preprod</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={networks.includes('Mainnet')}
                  onCheckedChange={() => handleNetworkToggle('Mainnet')}
                />
                <label className="text-sm">Mainnet</label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={usageLimited}
                onCheckedChange={(checked) =>
                  setUsageLimited(checked as boolean)
                }
                disabled={permission === 'Read'}
              />
              <label className="text-sm font-medium">Limit Usage</label>
            </div>
          </div>

          {usageLimited && permission !== 'Read' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">ADA Limit</label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={credits.lovelace}
                  onChange={(e) =>
                    setCredits((prev) => ({
                      ...prev,
                      lovelace: e.target.value,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Amount in ADA (will be converted to lovelace)
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">USDM Limit</label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={credits.usdm}
                  onChange={(e) =>
                    setCredits((prev) => ({ ...prev, usdm: e.target.value }))
                  }
                />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
