import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useAppContext } from "@/lib/contexts/AppContext";
import { postApiKey } from "@/lib/api/generated";
import { toast } from "react-toastify";

interface AddApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddApiKeyDialog({ open, onClose, onSuccess }: AddApiKeyDialogProps) {
  const [permission, setPermission] = useState<'Read' | 'ReadAndPay' | 'Admin'>('Admin');
  const [serviceType, setServiceType] = useState("");
  const [limitAda, setLimitAda] = useState("");
  const [limitUsdm, setLimitUsdm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { apiClient } = useAppContext();

  const handleSubmit = async () => {
    try {
      setIsLoading(true);

      await postApiKey({
        client: apiClient,
        body: {
          permission,
          usageLimited: "true",
          networkLimit: ['Preprod', 'Mainnet'],
          UsageCredits: [
            {
              unit: 'lovelace',
              amount: (parseFloat(limitAda) * 1000000).toString()
            },
            {
              unit: 'usdm',
              amount: limitUsdm
            }
          ]
        }
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add API key</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Type</label>
            <Select value={permission} onValueChange={(value: 'Read' | 'ReadAndPay' | 'Admin') => setPermission(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Admin">Admin</SelectItem>
                <SelectItem value="Read">Read</SelectItem>
                <SelectItem value="ReadAndPay">Read and Pay</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Service type</label>
            <Select value={serviceType} onValueChange={setServiceType}>
              <SelectTrigger>
                <SelectValue placeholder="Service type name" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="type1">Service Type 1</SelectItem>
                <SelectItem value="type2">Service Type 2</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Limit, ADA</label>
            <Input
              type="number"
              placeholder="0.00"
              value={limitAda}
              onChange={(e) => setLimitAda(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Limit, USDM</label>
            <Input
              type="number"
              placeholder="0.00"
              value={limitUsdm}
              onChange={(e) => setLimitUsdm(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
} 