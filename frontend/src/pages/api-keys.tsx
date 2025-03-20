/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { MainLayout } from '@/components/layout/MainLayout';
import Head from 'next/head';
import { useAppContext } from '@/lib/contexts/AppContext';
import { getApiKey } from '@/lib/api/generated';
import { toast } from 'react-toastify';
import { AddApiKeyDialog } from '@/components/api-keys/AddApiKeyDialog';
import { DeleteApiKeyDialog } from '@/components/api-keys/DeleteApiKeyDialog';
import { Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search } from 'lucide-react';
import { Tabs } from '@/components/ui/tabs';

interface ApiKey {
  id: string;
  token: string;
  name: string;
  permission: 'Read' | 'ReadAndPay' | 'Admin';
  usageLimited: boolean;
  networkLimit: ('Preprod' | 'Mainnet')[];
  RemainingUsageCredits: Array<{
    unit: string;
    amount: string;
  }>;
  requestsMade: number;
  usedAda: number;
  usedUsdm: number;
  status: string;
}

export default function ApiKeys() {
  const { apiClient } = useAppContext();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [allApiKeys, setAllApiKeys] = useState<ApiKey[]>([]);
  const [filteredApiKeys, setFilteredApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('All');

  const tabs = [
    { name: 'All', count: null },
    { name: 'Read', count: null },
    { name: 'ReadAndPay', count: null },
    { name: 'Admin', count: null },
  ];

  const filterApiKeys = useCallback(() => {
    let filtered = [...allApiKeys];

    if (activeTab === 'Read') {
      filtered = filtered.filter(key => key.permission === 'Read');
    } else if (activeTab === 'ReadAndPay') {
      filtered = filtered.filter(key => key.permission === 'ReadAndPay');
    } else if (activeTab === 'Admin') {
      filtered = filtered.filter(key => key.permission === 'Admin');
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(key => {
        const nameMatch = key.name?.toLowerCase().includes(query) || false;
        const tokenMatch = key.token?.toLowerCase().includes(query) || false;

        return nameMatch || tokenMatch;
      });
    }

    setFilteredApiKeys(filtered);
  }, [allApiKeys, searchQuery, activeTab]);

  const fetchApiKeys = async () => {
    try {
      setIsLoading(true);
      const response = await getApiKey({ client: apiClient });
      if (response?.data?.data?.ApiKeys) {
        const transformedKeys = response.data.data.ApiKeys.map(key => ({
          ...key,
          name: 'Service type name',
          requestsMade: 0,
          usedAda: 0,
          usedUsdm: 0
        }));
        setAllApiKeys(transformedKeys);
        setFilteredApiKeys(transformedKeys);
      } else {
        setAllApiKeys([]);
        setFilteredApiKeys([]);
      }
    } catch (error) {
      console.error('Error fetching API keys:', error);
      toast.error('Failed to fetch API keys');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchApiKeys();
  }, []);

  useEffect(() => {
    filterApiKeys();
  }, [filterApiKeys, searchQuery, activeTab]);

  const handleSelectKey = (token: string) => {
    setSelectedKeys(prev => 
      prev.includes(token) 
        ? prev.filter(k => k !== token)
        : [...prev, token]
    );
  };

  const handleSelectAll = () => {
    setSelectedKeys(
      selectedKeys.length === allApiKeys.length
        ? []
        : allApiKeys.map(key => key.token)
    );
  };

  const handleCopyApiKey = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('API key copied to clipboard');
    } catch {
      toast.error('Failed to copy API key');
    }
  };

  return (
    <MainLayout>
      <Head>
        <title>API Keys | Admin Interface</title>
      </Head>
      <div>
        <div className="mb-6">
          <h1 className="text-xl font-semibold mb-1">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Lorem ipsum dolor sit amet consectetur. Arcu tempus iaculis.{' '}
            <a href="#" className="text-primary hover:underline">Learn more</a>
          </p>
        </div>

        <div className="space-y-6">
          <Tabs 
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          <div className="flex justify-between items-center">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by name, key ID, permission, status, network, or usage"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-xs pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline"
                onClick={() => setSelectedKeys([])}
              >
                Clear selection
              </Button>
              <Button 
                onClick={() => setIsAddDialogOpen(true)}
              >
                Add API key
              </Button>
            </div>
          </div>

          <div className="border rounded-lg">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="w-12 p-4">
                    <Checkbox
                      checked={allApiKeys.length > 0 && selectedKeys.length === allApiKeys.length}
                      onCheckedChange={handleSelectAll}
                    />
                  </th>
                  <th className="p-4 text-left text-sm font-medium">Name</th>
                  <th className="p-4 text-left text-sm font-medium">Key ID</th>
                  <th className="p-4 text-left text-sm font-medium">Limit, ADA</th>
                  <th className="p-4 text-left text-sm font-medium">Limit, USDM</th>
                  <th className="p-4 text-left text-sm font-medium">Requests made</th>
                  <th className="p-4 text-left text-sm font-medium">Used, ADA</th>
                  <th className="p-4 text-left text-sm font-medium">Used, USDM</th>
                  <th className="w-12 p-4"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={9}>
                      <Spinner size={20} addContainer />
                    </td>
                  </tr>
                ) : filteredApiKeys.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8">
                      {searchQuery ? 'No API keys found matching your search' : 'No API keys found'}
                    </td>
                  </tr>
                ) : (
                  filteredApiKeys.map((key) => (
                    <tr key={key.token} className="border-b">
                      <td className="p-4">
                        <Checkbox
                          checked={selectedKeys.includes(key.token)}
                          onCheckedChange={() => handleSelectKey(key.token)}
                        />
                      </td>
                      <td className="p-4">
                        <div className="text-sm">Service type name</div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 p-0"
                            onClick={() => handleCopyApiKey(key.token)}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M10 4H5C4.44772 4 4 4.44772 4 5V10C4 10.5523 4.44772 11 5 11H10C10.5523 11 11 10.5523 11 10V5C11 4.44772 10.5523 4 10 4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M8 4V2C8 1.44772 7.55228 1 7 1H2C1.44772 1 1 1.44772 1 2V7C1 7.55228 1.44772 8 2 8H4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </Button>
                          <span className="font-mono text-sm text-muted-foreground">
                            {key.token.slice(0, 15)}...{key.token.slice(-15)}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-sm">10.00</td>
                      <td className="p-4 text-sm">10.00</td>
                      <td className="p-4 text-sm">{key.requestsMade}</td>
                      <td className="p-4 text-sm">{key.usedAda.toFixed(2)}</td>
                      <td className="p-4 text-sm">{key.usedUsdm.toFixed(2)}</td>
                      <td className="p-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 w-9">
                              •••
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={() => {
                              console.log('Regenerate clicked');
                            }}>
                              Regenerate
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onSelect={() => setKeyToDelete(key.id)}
                              className="text-red-600"
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="text-sm text-muted-foreground">
            Total: {filteredApiKeys.length}
          </div>
        </div>
      </div>

      <AddApiKeyDialog
        open={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={fetchApiKeys}
      />

      <DeleteApiKeyDialog
        open={!!keyToDelete}
        onClose={() => setKeyToDelete(null)}
        onSuccess={fetchApiKeys}
        apiKey={{ id: keyToDelete || '' }}
      />
    </MainLayout>
  );
} 