import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "react-toastify";
import { Download, Eye, Copy, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import router from "next/router";
import { Spinner } from "@/components/ui/spinner";
function WelcomeScreen({ onStart, networkType }: { onStart: () => void; networkType: string }) {
  const networkDisplay = networkType === 'mainnet' ? 'Mainnet' : 'Preprod';
  
  return (
    <div className="text-center space-y-4 max-w-[600px]">
      <h1 className="text-4xl font-bold">Welcome!</h1>
      <h2 className="text-3xl font-bold">Let&apos;s set up your<br />{networkDisplay} environment</h2>
      
      <p className="text-sm text-muted-foreground mt-4 mb-8 text-center max-w-md">
        Lorem ipsum dolor sit amet consectetur. Cras mi quam eget nec leo et in mi proin. 
        Fermentum aliquam nisl orci id egestas non maecenas.
      </p>

      <div className="flex items-center justify-center gap-4 mt-8">
        <Button variant="secondary" className="text-sm">
          Skip for now
        </Button>
        <Button className="text-sm" onClick={onStart}>
          Start setup
        </Button>
      </div>
    </div>
  );
}

function SeedPhrasesScreen({ onNext }: { onNext: () => void }) {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(true);
  const [buyingWallet, setBuyingWallet] = useState("");
  const [sellingWallet, setSellingWallet] = useState("");
  const [buyingSeed] = useState("*".repeat(96));
  const [sellingSeed] = useState("*".repeat(96));

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Seedphrase copied successfully");
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setBuyingWallet("126f48bb1824c271b64c8716bc2478b1624c781266b4cb716b24c7216b");
      setSellingWallet("126f48bb1824c271b64c8716bc2478b1624c781266b4cb716b24c7216b");
      setIsGenerating(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-6 max-w-[600px] w-full">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Save seed phrases</h1>
        <p className="text-sm text-muted-foreground">
          Lorem ipsum dolor sit amet consectetur. Cras mi quam eget nec leo et in mi proin. 
          Fermentum aliquam nisl orci id egestas non maecenas.
        </p>
      </div>

      <div className="space-y-6 w-full">
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-black text-white dark:bg-white/10 dark:text-white">Buying</span>
            <h3 className="text-sm font-medium">Buying wallet</h3>
          </div>
          {isGenerating ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size={16} />
              Generating...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleCopy(buyingWallet)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {buyingWallet}
              </div>
              <div className="border-t border-border my-4" />
              <div>
                <div className="text-sm font-medium mb-2">Seed phrase</div>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleCopy(buyingSeed)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <div className="flex-1 font-mono text-sm text-muted-foreground break-all">
                      {buyingSeed}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      className="text-sm flex items-center gap-2 bg-black text-white hover:bg-black/90"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-8 w-8"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="flex items-center gap-2">
             <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#FFF7ED] text-[#C2410C] dark:bg-[#C2410C]/10 dark:text-[#FFF7ED]">Selling</span>
              <h3 className="text-sm font-medium">Selling wallet</h3>
            </div>
          {isGenerating ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size={16} />
              Generating...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleCopy(sellingWallet)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {sellingWallet}
              </div>
              <div className="border-t border-border my-4" />
              <div>
                <div className="text-sm font-medium mb-2">Seed phrase</div>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleCopy(sellingSeed)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <div className="flex-1 font-mono text-sm text-muted-foreground break-all">
                      {sellingSeed}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      className="text-sm flex items-center gap-2 bg-black text-white hover:bg-black/90"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-8 w-8"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox 
            id="confirm" 
            checked={isConfirmed}
            onCheckedChange={(checked) => setIsConfirmed(checked as boolean)}
            disabled={isGenerating}
          />
          <label htmlFor="confirm" className="text-sm text-muted-foreground">
            I saved both seed phrases in a secure place
          </label>
        </div>

        <div className="flex items-center justify-center gap-4 pt-4">
          {isGenerating && (
            <Button variant="secondary" className="text-sm">
              Skip for now
            </Button>
          )}
          <Button 
            className="text-sm" 
            disabled={isGenerating || !isConfirmed}
            onClick={onNext}
          >
            {isGenerating ? "Generating..." : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddAiAgentScreen({ onNext }: { onNext: () => void }) {
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [sellingWallet] = useState("126f48bb1824c271b64c8716bc2478b1624c781266b4cb716b24c7216b");

  const handleAddTag = () => {
    if (newTag && !tags.includes(newTag)) {
      setTags([...tags, newTag]);
      setNewTag("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  return (
    <div className="space-y-6 max-w-[600px] w-full">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Add AI agent</h1>
        <p className="text-sm text-muted-foreground">
          Lorem ipsum dolor sit amet consectetur. Cras mi quam eget nec leo et in mi proin. 
          Fermentum aliquam nisl orci id egestas non maecenas.
        </p>
        <button className="text-sm text-primary hover:underline">Learn more</button>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">API URL</label>
          <Input placeholder="Enter API URL" />
          <p className="text-sm text-muted-foreground">This is an input description.</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Name</label>
          <Input placeholder="Enter name" />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Description</label>
          <Textarea placeholder="Enter description" className="min-h-[100px]" />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Linked wallet</label>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#FFF7ED] text-[#C2410C] dark:bg-[#C2410C]/10 dark:text-[#FFF7ED]">Selling</span>
              <span className="text-sm font-medium">Selling wallet</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Button 
                variant="ghost" 
                size="icon"
                className="h-8 w-8"
              >
                <Copy className="h-4 w-4" />
              </Button>
              {sellingWallet}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">All payments for using this AI agent will be credited to this wallet</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Price, ADA</label>
          <Input type="number" placeholder="0.00" />
          <p className="text-sm text-muted-foreground">This is an input description.</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Tags</label>
          <div className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <div key={tag} className="flex items-center gap-1 bg-secondary px-2 py-1 rounded-full">
                <span className="text-sm">{tag}</span>
                <button onClick={() => handleRemoveTag(tag)}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input 
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                placeholder="Add tag..."
                className="w-24"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Status</label>
          <Select defaultValue="active">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">This is a select description.</p>
        </div>

        <div className="flex items-center justify-center gap-4 pt-4">
          <Button variant="secondary" className="text-sm">
            Skip for now
          </Button>
          <Button className="text-sm" onClick={onNext}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function SuccessScreen({ onComplete, networkType }: { onComplete: () => void; networkType: string }) {
  return (
    <div className="text-center space-y-4 max-w-[600px]">
      <div className="flex justify-center mb-6">
        <span role="img" aria-label="celebration" className="text-4xl">🎉</span>
      </div>
      <h1 className="text-4xl font-bold">Your {networkType === 'mainnet' ? 'Mainnet' : 'Preprod'} environment<br />is all set!</h1>
      
      <p className="text-sm text-muted-foreground mt-4 mb-8">
        Lorem ipsum dolor sit amet consectetur. Cras mi quam eget nec leo et in mi proin. 
        Fermentum aliquam nisl orci id egestas non maecenas.
      </p>

      <div className="flex items-center justify-center">
        <Button className="text-sm" onClick={onComplete}>
          Complete
        </Button>
      </div>
    </div>
  );
}

export function SetupWelcome({ networkType }: { networkType: string }) {
  const [currentStep, setCurrentStep] = useState(0);

  const handleComplete = () => {
    router.push('/');
  };

  const steps = [
    <WelcomeScreen key="welcome" onStart={() => setCurrentStep(1)} networkType={networkType} />,
    <SeedPhrasesScreen key="seed" onNext={() => setCurrentStep(2)} />,
    <AddAiAgentScreen key="ai" onNext={() => setCurrentStep(3)} />,
    <SuccessScreen key="success" onComplete={handleComplete} networkType={networkType} />
  ];

  return (
    <div className="min-h-screen flex flex-col w-full">
      <Header />
      <main className="flex-1 container w-full max-w-[1200px] mx-auto py-32 px-4">
        <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
          {steps[currentStep]}
        </div>
      </main>
      <Footer />
    </div>
  );
} 