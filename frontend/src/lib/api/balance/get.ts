
interface GetWalletResponse {
    status: 'success' | 'error';
    ada: number;
    usdm: number;
}

interface GetWalletOptions {
    walletAddress: string;
    network: string;
    count: number;
    page: number;

}

export async function getWalletBalance(token: string, options: GetWalletOptions): Promise<GetWalletResponse> {
    if (!token) {
        throw new Error('Authorization token is required');
    }

    try {
        const queryParams = new URLSearchParams({
            walletAddress: options.walletAddress,
            network: options.network,
            count: options.count.toString(),
            page: options.page.toString()
        });



        const response = await fetch(
            `${process.env.NEXT_PUBLIC_PAYMENT_API_BASE_URL}/api/v1/utxos?${queryParams}`,
            {
                headers: {
                    'accept': 'application/json',
                    'token': token
                }
            }
        );


        const utxos = await response.json();
        const usdmPolicyId = "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad";
        const usdmHex = "0014df105553444d"

        const balanceAda = utxos.reduce((total: number, utxo: { amount: { unit: string, quantity: string }[] }) => {
            const value = utxo.amount.find((amt) => amt.unit === "lovelace");
            return total + (value ? parseInt(value.quantity) : 0);
        }, 0);

        const balanceUsdm = utxos.reduce((total: number, utxo: { amount: { unit: string, quantity: string }[] }) => {
            const value = utxo.amount.find((amt) => amt.unit?.startsWith(usdmPolicyId + usdmHex));
            return total + (value ? parseInt(value.quantity) : 0);
        }, 0);

        console.log("utxos: ", utxos);
        console.log("balanceAda: ", balanceAda);
        console.log("balanceUsdm: ", balanceUsdm);

        return {
            ada: balanceAda / 1000000,
            usdm: balanceUsdm / 10000000,
            status: 'success'
        };
    } catch (error) {
        console.error('Error fetching API keys:', error);
        throw error instanceof Error ? error : new Error('Failed to fetch API keys');
    }
}
