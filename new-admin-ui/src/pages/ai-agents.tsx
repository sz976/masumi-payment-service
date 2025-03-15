/* eslint-disable react-hooks/exhaustive-deps */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MainLayout } from "@/components/layout/MainLayout";
import { Plus, Filter, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { AddAIAgentDialog } from "@/components/ai-agents/AddAIAgentDialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useAppContext } from "@/lib/contexts/AppContext";
import { getRegistry } from "@/lib/api/generated";
import { toast } from "react-toastify";
import Head from "next/head";
import { Spinner } from "@/components/ui/spinner";

interface AIAgent {
  id: string;
  name: string;
  description: string | null;
  apiBaseUrl: string;
  state: 'RegistrationRequested' | 'RegistrationInitiated' | 'RegistrationConfirmed' | 'RegistrationFailed' | 'DeregistrationRequested' | 'DeregistrationInitiated' | 'DeregistrationConfirmed' | 'DeregistrationFailed';
  Tags: string[];
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  agentIdentifier: string | null;
  AgentPricing: {
    pricingType: 'Fixed';
    Pricing: Array<{
      amount: string;
      unit: string;
    }>;
  };
  SmartContractWallet: {
    walletVkey: string;
    walletAddress: string;
  };
}

export default function AIAgentsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { apiClient } = useAppContext();

  const fetchAgents = async () => {
    try {
      setIsLoading(true);
      const response = await getRegistry({
        client: apiClient,
        query: {
          network: 'Preprod',
        }
      });

      if (response.data?.data?.Assets) {
        setAgents(response.data.data.Assets);
      }
    } catch (error) {
      console.error('Error fetching agents:', error);
      toast.error('Failed to load AI agents');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleSelectAgent = (id: string) => {
    setSelectedAgents(prev => 
      prev.includes(id) 
        ? prev.filter(agentId => agentId !== id)
        : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (agents.length === 0) {
      setSelectedAgents([]);
      return;
    }

    if (selectedAgents.length === agents.length) {
      setSelectedAgents([]);
    } else {
      setSelectedAgents(agents.map(agent => agent.id));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusBadgeVariant = (status: AIAgent['state']) => {
    if (status.includes('Confirmed')) return 'default';
    if (status.includes('Failed')) return 'destructive';
    return 'secondary';
  };

  return (
    <MainLayout>
      <Head>
        <title>AI Agents | Admin Interface</title>
      </Head>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold mb-1">AI agents</h1>
            <p className="text-sm text-muted-foreground">
              Manage your AI agents and their configurations.{' '}
              <a href="#" className="text-primary hover:underline">Learn more</a>
            </p>
          </div>
          <Button 
            className="flex items-center gap-2"
            onClick={() => setIsAddDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add AI agent
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              type="search"
              placeholder="Search AI agent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-xs pl-10"
            />
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10">
            <Filter className="h-4 w-4" />
          </Button>
        </div>

        <div className="rounded-lg border">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="w-12 p-4">
                  <Checkbox 
                    checked={agents.length > 0 && selectedAgents.length === agents.length}
                    onCheckedChange={handleSelectAll}
                  />
                </th>
                <th className="p-4 text-left text-sm font-medium">Name</th>
                <th className="p-4 text-left text-sm font-medium">Added</th>
                <th className="p-4 text-left text-sm font-medium">Linked wallet</th>
                <th className="p-4 text-left text-sm font-medium">Price, ADA</th>
                <th className="p-4 text-left text-sm font-medium">Tags</th>
                <th className="p-4 text-left text-sm font-medium">Status</th>
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
              ) : agents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8">
                    No AI agents found
                  </td>
                </tr>
              ) : (
                agents.map((agent) => (
                  <tr key={agent.id} className="border-b">
                    <td className="p-4">
                      <Checkbox 
                        checked={selectedAgents.includes(agent.id)}
                        onCheckedChange={() => handleSelectAgent(agent.id)}
                      />
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-medium">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">{agent.description}</div>
                    </td>
                    <td className="p-4 text-sm">{formatDate(agent.createdAt)}</td>
                    <td className="p-4">
                      <div className="text-xs font-medium">Selling wallet</div>
                      <div className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                        {agent.SmartContractWallet.walletAddress}
                      </div>
                    </td>
                    <td className="p-4 text-sm">
                      {agent.AgentPricing.Pricing[0]?.amount || '—'}
                    </td>
                    <td className="p-4">
                      {agent.Tags.length > 0 && (
                        <Badge variant="secondary">
                          {agent.Tags.length} tags
                        </Badge>
                      )}
                    </td>
                    <td className="p-4">
                      <Badge 
                        variant={getStatusBadgeVariant(agent.state)}
                        className={cn(
                          agent.state === 'RegistrationConfirmed' && "bg-green-50 text-green-700 hover:bg-green-50/80"
                        )}
                      >
                        {agent.state}
                      </Badge>
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

        <div className="text-sm text-muted-foreground">
          Total: {agents.length}
        </div>
      </div>

      <AddAIAgentDialog 
        open={isAddDialogOpen} 
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={fetchAgents}
      />
    </MainLayout>
  );
} 