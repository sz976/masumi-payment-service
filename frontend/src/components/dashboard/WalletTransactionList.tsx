import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState, useEffect, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/pagination";
import { useAppContext } from "@/lib/contexts/AppContext";
import { getTransactions } from "@/lib/api/transactions";

type WalletTransactionListProps = {
  walletAddress: string;
}

type Transaction = {
  id: string;
  hash: string;
  type: string;
  amount: number;
  date: string;
}
export function WalletTransactionList({ walletAddress }: WalletTransactionListProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const { state } = useAppContext();

  const fetchTransactions = useCallback(async (cursorId?: string) => {
    setIsLoading(true);
    try {


      const response = await getTransactions(state.apiKey!, {
        ...(walletAddress && { walletAddress }),
        ...(cursor && { cursorIdentifier: cursor }),
        limit: 10
      });

      const data = response.data;
      const newTransactions = (data?.transactions || []) as unknown as Transaction[];

      setTransactions(cursorId ? [...transactions, ...newTransactions] : newTransactions);
      setHasMore(newTransactions.length === 10);
      setCursor(newTransactions[newTransactions.length - 1]?.id || null);
    } catch (error) {
      console.error('Failed to fetch wallet transactions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [state.apiKey, walletAddress, cursor, transactions]);

  useEffect(() => {
    if (walletAddress) {
      fetchTransactions();
    }
  }, [fetchTransactions, walletAddress]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && transactions.length === 0 ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
            <Skeleton className="h-4 w-[300px]" />
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction Hash</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No transactions found
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-mono">{tx.hash}</TableCell>
                        <TableCell>{tx.type}</TableCell>
                        <TableCell>{tx.amount}</TableCell>
                        <TableCell>{new Date(tx.date).toLocaleString()}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <Pagination
              hasMore={hasMore}
              isLoading={isLoading}
              onLoadMore={() => cursor && fetchTransactions(cursor)}
              className="mt-4"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
} 