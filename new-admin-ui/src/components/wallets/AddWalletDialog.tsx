import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PiSpinnerGap } from "react-icons/pi";
import { LuCopy, LuDownload, LuEye, LuEyeOff, LuCheck } from "react-icons/lu";
import { useState, useEffect } from "react";

interface AddWalletDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AddWalletDialog({ open, onClose, onSuccess }: AddWalletDialogProps) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<'buying' | 'selling'>('buying');
  const [walletAddress, setWalletAddress] = useState('');
  const [seedPhrase, setSeedPhrase] = useState('');
  const [isSeedSaved, setIsSeedSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);
  const [isSeedVisible, setIsSeedVisible] = useState(false);

  useEffect(() => {
    if (step === 2 && loading) {
      const timer = setTimeout(() => {
        setWalletAddress('126t48bo1824c271b64c8716bc2478o1624c78126ob4co716b24c7216b');
        setSeedPhrase('****************************************************************************************************************');
        setLoading(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step, loading]);

  const handleNext = () => {
    if (step < 2) {
      setStep(step + 1);
      setLoading(true);
    } else {
      onSuccess?.();
      onClose();
    }
  };

  const handleCopy = async (text: string, type: 'wallet' | 'seed') => {
    await navigator.clipboard.writeText(text);
    if (type === 'wallet') {
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 2000);
    } else {
      setCopiedSeed(true);
      setTimeout(() => setCopiedSeed(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Add wallet</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex justify-start gap-4 text-sm font-medium text-muted-foreground border-b pb-4">
            <span className={step === 1 ? "text-primary" : ""}>1. Generate wallet</span>
            <span className={step === 2 ? "text-primary" : ""}>2. Save seed phrase</span>
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Wallet type</label>
                <Select 
                  value={type} 
                  onValueChange={(value: 'buying' | 'selling') => setType(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buying">Buying wallet</SelectItem>
                    <SelectItem value="selling">Selling wallet</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">This is a select description.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Wallet name</label>
                <Input placeholder="Enter wallet name" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Textarea placeholder="Enter description" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Lorem ipsum dolor sit amet consectetur. Purus et purus neque ac.
              </p>
              
              <div className="border rounded-lg p-6 space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex items-center rounded-full bg-black text-white px-2 py-0.5 text-xs">
                      buying
                    </span>
                    <span className="text-sm font-medium">Buying wallet</span>
                  </div>
                
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <PiSpinnerGap className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Generating...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-4 w-4 p-0"
                        onClick={() => handleCopy(walletAddress, 'wallet')}
                      >
                        {copiedWallet ? (
                          <LuCheck className="h-4 w-4 text-green-500" />
                        ) : (
                          <LuCopy className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                      <span className="text-sm font-medium">{walletAddress}</span>
                    </div>
                  )}
                </div>

                <div className="border-t pt-4">
                  <div className="text-sm mb-4">Seed phrase</div>
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <PiSpinnerGap className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Generating...</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2 mb-4">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-4 w-4 p-0"
                          onClick={() => handleCopy(seedPhrase, 'seed')}
                        >
                          {copiedSeed ? (
                            <LuCheck className="h-4 w-4 text-green-500" />
                          ) : (
                            <LuCopy className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                        <span className="font-mono text-sm break-all">
                          {isSeedVisible ? seedPhrase : '****************************************************************************************************************'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="default" className="bg-black text-white hover:bg-black/90 gap-2">
                          <LuDownload className="h-4 w-4" />
                          Download
                        </Button>
                        <Button 
                          variant="outline" 
                          size="icon"
                          onClick={() => setIsSeedVisible(!isSeedVisible)}
                        >
                          {isSeedVisible ? (
                            <LuEyeOff className="h-4 w-4" />
                          ) : (
                            <LuEye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  checked={isSeedSaved} 
                  onChange={(e) => setIsSeedSaved(e.target.checked)}
                  className="rounded border-gray-300"
                  disabled={loading}
                />
                <label className="text-sm text-muted-foreground">
                  I saved seed phrase in a secure place
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-6">
          <Button variant="outline" onClick={onClose} className="px-6">
            Cancel
          </Button>
          <Button 
            onClick={handleNext} 
            disabled={(step === 2 && !isSeedSaved) || loading}
            className="px-6"
          >
            {step === 2 ? 'Complete' : 'Next'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
} 