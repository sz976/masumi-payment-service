/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react-hooks/rules-of-hooks */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MainLayout } from '@/components/layout/MainLayout';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { RegisterAIAgentDialog } from '@/components/ai-agents/RegisterAIAgentDialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn, shortenAddress } from '@/lib/utils';
import { useAppContext } from '@/lib/contexts/AppContext';
import {
  getRegistry,
  deleteRegistry,
  GetRegistryResponses,
  getUtxos,
  postRegistryDeregister,
} from '@/lib/api/generated';
import { toast } from 'react-toastify';
import Head from 'next/head';
import { Spinner } from '@/components/ui/spinner';
import useFormatBalance from '@/lib/hooks/useFormatBalance';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FaRegClock } from 'react-icons/fa';
import { Tabs } from '@/components/ui/tabs';
import { Pagination } from '@/components/ui/pagination';
import { AIAgentDetailsDialog } from '@/components/ai-agents/AIAgentDetailsDialog';
import {
  WalletDetailsDialog,
  WalletWithBalance,
} from '@/components/wallets/WalletDetailsDialog';
import { CopyButton } from '@/components/ui/copy-button';
import { TESTUSDM_CONFIG, getUsdmConfig } from '@/lib/constants/defaultWallets';
type AIAgent = GetRegistryResponses['200']['data']['Assets'][0];

const parseAgentStatus = (status: AIAgent['state']): string => {
  switch (status) {
    case 'RegistrationRequested':
      return 'Pending';
    case 'RegistrationInitiated':
      return 'Registering';
    case 'RegistrationConfirmed':
      return 'Registered';
    case 'RegistrationFailed':
      return 'Registration Failed';
    case 'DeregistrationRequested':
      return 'Pending';
    case 'DeregistrationInitiated':
      return 'Deregistering';
    case 'DeregistrationConfirmed':
      return 'Deregistered';
    case 'DeregistrationFailed':
      return 'Deregistration Failed';
    default:
      return status;
  }
};

export default function AIAgentsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isRegisterDialogOpen, setIsRegisterDialogOpen] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [allAgents, setAllAgents] = useState<AIAgent[]>([]);
  const [filteredAgents, setFilteredAgents] = useState<AIAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedAgentToDelete, setSelectedAgentToDelete] =
    useState<AIAgent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { apiClient, state, selectedPaymentSourceId } = useAppContext();
  const [activeTab, setActiveTab] = useState('All');
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedAgentForDetails, setSelectedAgentForDetails] =
    useState<AIAgent | null>(null);
  const [selectedWalletForDetails, setSelectedWalletForDetails] =
    useState<WalletWithBalance | null>(null);

  const tabs = [
    { name: 'All', count: null },
    { name: 'Registered', count: null },
    { name: 'Deregistered', count: null },
    { name: 'Pending', count: null },
    { name: 'Failed', count: null },
  ];

  const filterAgents = useCallback(() => {
    let filtered = [...allAgents];

    if (activeTab === 'Registered') {
      filtered = filtered.filter(
        (agent) => parseAgentStatus(agent.state) === 'Registered',
      );
    } else if (activeTab === 'Deregistered') {
      filtered = filtered.filter(
        (agent) => parseAgentStatus(agent.state) === 'Deregistered',
      );
    } else if (activeTab === 'Pending') {
      filtered = filtered.filter(
        (agent) => parseAgentStatus(agent.state) === 'Pending',
      );
    } else if (activeTab === 'Failed') {
      filtered = filtered.filter(
        (agent) => agent.state && agent.state.includes('Failed'),
      );
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((agent) => {
        const matchName = agent.name?.toLowerCase().includes(query) || false;
        const matchDescription =
          agent.description?.toLowerCase().includes(query) || false;
        const matchTags =
          agent.Tags?.some((tag) => tag.toLowerCase().includes(query)) || false;
        const matchWallet =
          agent.SmartContractWallet?.walletAddress
            ?.toLowerCase()
            .includes(query) || false;
        const matchState = agent.state?.toLowerCase().includes(query) || false;
        const matchPrice = agent.AgentPricing?.Pricing?.[0]?.amount
          ? (parseInt(agent.AgentPricing.Pricing[0].amount) / 1000000)
              .toFixed(2)
              .includes(query)
          : false;

        return (
          matchName ||
          matchDescription ||
          matchTags ||
          matchWallet ||
          matchState ||
          matchPrice
        );
      });
    }

    setFilteredAgents(filtered);
  }, [allAgents, searchQuery, activeTab]);

  const fetchAgents = useCallback(
    async (cursor?: string | null) => {
      try {
        if (!cursor) {
          setIsLoading(true);
          setAllAgents([]);
        } else {
          setIsLoadingMore(true);
        }

        const selectedPaymentSource = state.paymentSources.find(
          (ps) => ps.id === selectedPaymentSourceId,
        );
        const smartContractAddress =
          selectedPaymentSource?.smartContractAddress;

        const response = await getRegistry({
          client: apiClient,
          query: {
            network: state.network,
            cursorId: cursor || undefined,
            filterSmartContractAddress: smartContractAddress
              ? smartContractAddress
              : undefined,
          },
        });

        if (response.data?.data?.Assets) {
          const newAgents = response.data.data.Assets;
          if (cursor) {
            setAllAgents((prev) => [...prev, ...newAgents]);
          } else {
            setAllAgents(newAgents);
          }

          setHasMore(newAgents.length === 10);
        } else {
          if (!cursor) {
            setAllAgents([]);
          }
          setHasMore(false);
        }
      } catch (error) {
        console.error('Error fetching agents:', error);
        toast.error('Failed to load AI agents');
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [apiClient, state.network, selectedPaymentSourceId],
  );

  const handleLoadMore = () => {
    if (!isLoadingMore && hasMore && allAgents.length > 0) {
      const lastAgent = allAgents[allAgents.length - 1];
      fetchAgents(lastAgent.id);
    }
  };

  useEffect(() => {
    if (
      state.paymentSources &&
      state.paymentSources.length > 0 &&
      selectedPaymentSourceId
    ) {
      fetchAgents();
    }
  }, [state.network, state.paymentSources, selectedPaymentSourceId]);

  useEffect(() => {
    filterAgents();
  }, [filterAgents, searchQuery, activeTab]);

  const handleSelectAgent = (id: string) => {
    setSelectedAgents((prev) =>
      prev.includes(id)
        ? prev.filter((agentId) => agentId !== id)
        : [...prev, id],
    );
  };

  const handleSelectAll = () => {
    if (allAgents.length === 0) {
      setSelectedAgents([]);
      return;
    }

    if (selectedAgents.length === allAgents.length) {
      setSelectedAgents([]);
    } else {
      setSelectedAgents(allAgents.map((agent) => agent.id));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusBadgeVariant = (status: AIAgent['state']) => {
    if (status === 'RegistrationConfirmed') return 'default';
    if (status.includes('Failed')) return 'destructive';
    if (status.includes('Initiated')) return 'secondary';
    if (status.includes('Requested')) return 'secondary';
    if (status === 'DeregistrationConfirmed') return 'secondary';
    return 'secondary';
  };

  const useFormatPrice = (amount: string | undefined) => {
    if (!amount) return '—';
    return useFormatBalance((parseInt(amount) / 1000000).toFixed(2));
  };

  const handleDeleteClick = (agent: AIAgent) => {
    setSelectedAgentToDelete(agent);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      if (
        selectedAgentToDelete?.state === 'RegistrationFailed' ||
        selectedAgentToDelete?.state === 'DeregistrationConfirmed'
      ) {
        setIsDeleting(true);
        await deleteRegistry({
          client: apiClient,
          body: {
            id: selectedAgentToDelete.id,
          },
        });
        toast.success('AI agent deleted successfully');
        setIsDeleteDialogOpen(false);
        setSelectedAgentToDelete(null);
        fetchAgents();
      } else if (selectedAgentToDelete?.state === 'RegistrationConfirmed') {
        if (!selectedAgentToDelete?.agentIdentifier) {
          toast.error('Cannot delete agent: Missing identifier');
          return;
        }
        setIsDeleting(true);
        await postRegistryDeregister({
          client: apiClient,
          body: {
            agentIdentifier: selectedAgentToDelete.agentIdentifier,
            network: state.network,
          },
        });

        toast.success('AI agent deleted successfully');
        setIsDeleteDialogOpen(false);
        setSelectedAgentToDelete(null);
        fetchAgents();
      } else {
        toast.error(
          'Cannot delete agent: Agent is not in a state to be deleted. Please wait for transactions to settle.',
        );
      }
    } catch (error) {
      console.error('Error deleting agent:', error);
      toast.error('Failed to delete AI agent');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAgentClick = (agent: AIAgent) => {
    setSelectedAgentForDetails(agent);
  };

  const handleWalletClick = async (walletAddress: string) => {
    try {
      // Fetch wallet balance
      const response = await getUtxos({
        client: apiClient,
        query: {
          address: walletAddress,
          network: state.network,
        },
      });

      let adaBalance = '0';
      let usdmBalance = '0';

      if (response.data?.data?.Utxos) {
        response.data.data.Utxos.forEach((utxo) => {
          utxo.Amounts.forEach((amount) => {
            if (amount.unit === 'lovelace' || amount.unit === '') {
              adaBalance = (
                parseInt(adaBalance) + (amount.quantity || 0)
              ).toString();
            } else if (amount.unit === 'USDM') {
              usdmBalance = (
                parseInt(usdmBalance) + (amount.quantity || 0)
              ).toString();
            }
          });
        });
      }

      // Create wallet details object
      const walletDetails: WalletWithBalance = {
        id: walletAddress, // Using address as ID since we don't have the actual wallet ID
        walletVkey: '', // We don't have this information
        walletAddress,
        collectionAddress: null,
        note: null,
        type: 'Selling', // AI agents use selling wallets
        balance: adaBalance,
        usdmBalance,
      };

      setSelectedWalletForDetails(walletDetails);
    } catch (error) {
      console.error('Error fetching wallet details:', error);
      toast.error('Failed to fetch wallet details');
    }
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
              <a
                href="https://docs.masumi.network/core-concepts/agentic-service"
                target="_blank"
                className="text-primary hover:underline"
              >
                Learn more
              </a>
            </p>
          </div>
          <Button
            className="flex items-center gap-2"
            onClick={() => setIsRegisterDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Register AI Agent
          </Button>
        </div>

        <div className="space-y-6">
          <Tabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setAllAgents([]);
              fetchAgents();
            }}
          />

          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                type="search"
                placeholder="Search by name, description, tags, or wallet..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-xs pl-10"
              />
            </div>
          </div>

          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="w-12 p-4">
                    <Checkbox
                      checked={
                        allAgents.length > 0 &&
                        selectedAgents.length === allAgents.length
                      }
                      onCheckedChange={handleSelectAll}
                    />
                  </th>
                  <th className="p-4 text-left text-sm font-medium">Name</th>
                  <th className="p-4 text-left text-sm font-medium">Added</th>
                  <th className="p-4 text-left text-sm font-medium">
                    Agent ID
                  </th>
                  <th className="p-4 text-left text-sm font-medium">
                    Linked wallet
                  </th>
                  <th className="p-4 text-left text-sm font-medium">Price</th>
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
                ) : filteredAgents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8">
                      {searchQuery
                        ? 'No AI agents found matching your search'
                        : 'No AI agents found'}
                    </td>
                  </tr>
                ) : (
                  filteredAgents.map((agent) => (
                    <tr
                      key={agent.id}
                      className="border-b cursor-pointer hover:bg-muted/50"
                      style={{
                        opacity:
                          agent.state === 'DeregistrationConfirmed'
                            ? '0.4'
                            : '1',
                      }}
                      onClick={() => handleAgentClick(agent)}
                    >
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedAgents.includes(agent.id)}
                          onCheckedChange={() => handleSelectAgent(agent.id)}
                        />
                      </td>
                      <td className="p-4 max-w-[200px] truncate">
                        <div className="text-sm font-medium">{agent.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {agent.description}
                        </div>
                      </td>
                      <td className="p-4 text-sm">
                        {formatDate(agent.createdAt)}
                      </td>
                      <td className="p-4">
                        {agent.agentIdentifier ? (
                          <div className="text-xs font-mono truncate max-w-[200px] flex items-center gap-2">
                            <span className="cursor-pointer hover:text-primary">
                              {shortenAddress(agent.agentIdentifier)}
                            </span>
                            <CopyButton value={agent.agentIdentifier} />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="text-xs font-medium">
                          Selling wallet
                        </div>
                        <div className="text-xs text-muted-foreground font-mono truncate max-w-[200px] flex items-center gap-2">
                          <span
                            className="cursor-pointer hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleWalletClick(
                                agent.SmartContractWallet.walletAddress,
                              );
                            }}
                          >
                            {shortenAddress(
                              agent.SmartContractWallet.walletAddress,
                            )}
                          </span>
                          <CopyButton
                            value={agent.SmartContractWallet.walletAddress}
                          />
                        </div>
                      </td>
                      <td className="p-4 text-sm truncate max-w-[100px]">
                        {agent.AgentPricing?.Pricing?.map((price, index) => (
                          <div key={index} className="whitespace-nowrap">
                            {price.unit === 'lovelace' || !price.unit
                              ? `${useFormatPrice(price.amount)} ADA`
                              : `${useFormatPrice(price.amount)} ${price.unit === getUsdmConfig(state.network).fullAssetId ? 'USDM' : price.unit === TESTUSDM_CONFIG.unit ? 'tUSDM' : price.unit}`}
                          </div>
                        ))}
                      </td>
                      <td className="p-4">
                        {agent.Tags.length > 0 && (
                          <Badge variant="secondary" className="truncate">
                            {agent.Tags.length} tags
                          </Badge>
                        )}
                      </td>
                      <td className="p-4">
                        <Badge
                          variant={getStatusBadgeVariant(agent.state)}
                          className={cn(
                            agent.state === 'RegistrationConfirmed' &&
                              'bg-green-50 text-green-700 hover:bg-green-50/80',
                          )}
                        >
                          {parseAgentStatus(agent.state)}
                        </Badge>
                      </td>
                      <td className="p-4">
                        {[
                          'RegistrationConfirmed',
                          'RegistrationFailed',
                          'DeregistrationFailed',
                        ].includes(agent.state) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick(agent);
                            }}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : agent.state === 'RegistrationInitiated' ||
                          agent.state === 'DeregistrationInitiated' ? (
                          <div className="flex items-center justify-center w-8 h-8">
                            <Spinner size={16} />
                          </div>
                        ) : (
                          (agent.state === 'RegistrationRequested' ||
                            agent.state === 'DeregistrationRequested') && (
                            <div className="flex items-center justify-center w-8 h-8">
                              <FaRegClock size={12} />
                            </div>
                          )
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-4 items-center">
            {!isLoading && (
              <Pagination
                hasMore={hasMore}
                isLoading={isLoadingMore}
                onLoadMore={handleLoadMore}
              />
            )}
          </div>
        </div>

        <RegisterAIAgentDialog
          open={isRegisterDialogOpen}
          onClose={() => setIsRegisterDialogOpen(false)}
          onSuccess={fetchAgents}
        />

        <AIAgentDetailsDialog
          agent={selectedAgentForDetails}
          onClose={() => setSelectedAgentForDetails(null)}
        />

        <ConfirmDialog
          open={isDeleteDialogOpen}
          onClose={() => {
            setIsDeleteDialogOpen(false);
            setSelectedAgentToDelete(null);
          }}
          title="Delete AI Agent"
          description={
            selectedAgentToDelete?.state === 'RegistrationFailed' ||
            selectedAgentToDelete?.state === 'DeregistrationConfirmed'
              ? `Are you sure you want to delete "${selectedAgentToDelete?.name}"? This action cannot be undone.`
              : `Are you sure you want to deregister "${selectedAgentToDelete?.name}"? This action cannot be undone.`
          }
          onConfirm={async () => {
            await handleDeleteConfirm();
            setSelectedAgentForDetails(null);
          }}
          isLoading={isDeleting}
        />

        <WalletDetailsDialog
          isOpen={!!selectedWalletForDetails}
          onClose={() => setSelectedWalletForDetails(null)}
          wallet={selectedWalletForDetails}
        />
      </div>
    </MainLayout>
  );
}
