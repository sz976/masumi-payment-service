/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect, useCallback } from 'react';
import {
  patchPaymentSourceExtended,
  getPaymentSourceExtended,
  postWallet,
} from '@/lib/api/generated';
import { toast } from 'react-toastify';
import { useAppContext } from '@/lib/contexts/AppContext';
import { parseError } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

interface AddWalletDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const walletSchema = z.object({
  mnemonic: z.string().min(1, 'Mnemonic phrase is required'),
  note: z.string().min(1, 'Note is required'),
  collectionAddress: z.string().min(1, 'Collection address is required'),
});

type WalletFormValues = z.infer<typeof walletSchema>;

export function AddWalletDialog({
  open,
  onClose,
  onSuccess,
}: AddWalletDialogProps) {
  const [type, setType] = useState<'Purchasing' | 'Selling'>('Purchasing');
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>('');
  const [paymentSourceId, setPaymentSourceId] = useState<string | null>(null);
  const { apiClient, state } = useAppContext();

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<WalletFormValues>({
    resolver: zodResolver(walletSchema),
    defaultValues: {
      mnemonic: '',
      note: '',
      collectionAddress: '',
    },
  });

  useEffect(() => {
    if (open) {
      fetchPaymentSource();
    } else {
      reset();
      setError('');
    }
  }, [open]);

  const fetchPaymentSource = useCallback(async () => {
    try {
      const response = await getPaymentSourceExtended({
        client: apiClient,
      });
      const paymentSources =
        response.data?.data?.ExtendedPaymentSources?.filter((p) => {
          return p.network == state.network;
        });
      if (paymentSources?.length == 0) {
        console.error('No payment source for network found');
      }
      if (paymentSources?.[0]?.id) {
        setPaymentSourceId(paymentSources?.[0].id);
      } else {
        setError('No payment source found');
        onClose();
      }
    } catch (error) {
      console.error('Error fetching payment source:', error);
      setError('Failed to load payment source');
      onClose();
    }
  }, [state, state.network]);

  const handleGenerateMnemonic = async () => {
    try {
      setIsGenerating(true);
      setError('');

      const response: any = await postWallet({
        client: apiClient,
        body: {
          network: state.network,
        },
      });

      if (response.status === 200 && response.data?.data?.walletMnemonic) {
        setValue('mnemonic', response.data.data.walletMnemonic);
      } else {
        throw new Error('Failed to generate mnemonic phrase');
      }
    } catch (error: any) {
      console.error('Error generating mnemonic:', error);
      const errorMessage =
        error?.response?.data?.error ||
        error?.message ||
        'Failed to generate mnemonic phrase';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const onSubmit = async (data: WalletFormValues) => {
    setError('');

    if (!paymentSourceId) {
      setError('No payment source available');
      return;
    }

    setIsLoading(true);

    try {
      const response: any = await patchPaymentSourceExtended({
        client: apiClient,
        body: {
          id: paymentSourceId,
          [type === 'Purchasing'
            ? 'AddPurchasingWallets'
            : 'AddSellingWallets']: [
            {
              walletMnemonic: data.mnemonic.trim(),
              note: data.note.trim(),
              collectionAddress: data.collectionAddress.trim(),
            },
          ],
        },
      });

      if (response.status === 200) {
        toast.success(`${type} wallet added successfully`);
        onSuccess?.();
        onClose();
      } else {
        const err: any = parseError(response?.error);
        setError(err?.message || err.code || err);
      }
    } catch (error: any) {
      console.error(error);
      if (error.message) {
        setError(error.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Add {type} Wallet</DialogTitle>
          <DialogDescription>
            Enter the wallet mnemonic phrase and required details to set up your{' '}
            {type.toLowerCase()} wallet.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Wallet type</label>
            <Select
              value={type}
              onValueChange={(value: 'Purchasing' | 'Selling') =>
                setType(value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select wallet type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Purchasing">Purchasing wallet</SelectItem>
                <SelectItem value="Selling">Selling wallet</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {type === 'Purchasing'
                ? 'A purchasing wallet is used to make payments for Agentic AI services. It will be used to send payments to sellers.'
                : 'A selling wallet is used to receive payments for Agentic AI services. It will be used to collect funds from buyers.'}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                Mnemonic Phrase <span className="text-destructive">*</span>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateMnemonic}
                disabled={isGenerating}
                className="h-8"
              >
                {isGenerating ? <Spinner size={16} /> : 'Generate'}
              </Button>
            </div>
            <Textarea
              {...register('mnemonic')}
              placeholder="Enter your mnemonic phrase"
              required
              className="min-h-[100px] font-mono"
            />
            {errors.mnemonic && (
              <p className="text-xs text-destructive mt-1">
                {errors.mnemonic.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Note <span className="text-destructive">*</span>
            </label>
            <Input
              {...register('note')}
              placeholder="Enter a note to identify this wallet"
              required
            />
            {errors.note && (
              <p className="text-xs text-destructive mt-1">
                {errors.note.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {type === 'Purchasing' ? 'Refund' : 'Revenue'} Collection Address{' '}
              <span className="text-destructive">*</span>
            </label>
            <Input
              {...register('collectionAddress')}
              placeholder={`Enter the address where ${type === 'Purchasing' ? 'refunds' : 'revenue'} will be sent`}
              required
            />
            {errors.collectionAddress && (
              <p className="text-xs text-destructive mt-1">
                {errors.collectionAddress.message}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Adding...' : 'Add Wallet'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
