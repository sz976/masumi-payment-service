export const TOOLTIP_TEXTS = {
  PAYMENT_SOURCES:
    'Payment sources are smart contracts that handle payment processing on the blockchain. They define the payment terms, fees, and token types accepted for transactions.',
  WALLETS:
    'Selling wallets receive payments for the services you sell over the Masumi Network. Buying wallets pay for other services you purchase via the Masumi Network. Collection wallets gather fees and profits from completed transactions.',
  FEE_RECEIVER_WALLET:
    'The wallet address that will receive transaction fees from all payments processed through this payment source. This should be a wallet you control and can access.',
  NETWORK:
    'Choose between Mainnet (live transactions with real ADA) or Preprod (testnet for development and testing). Make sure your Blockfrost API key matches the selected network.',
  BLOCKFROST_API_KEY:
    'Your Blockfrost API key is required to interact with the Cardano blockchain. Get your free API key from blockfrost.io/dashboard and ensure it matches your selected network (Mainnet or Preprod).',
  FEE_PERMILLE:
    'The fee percentage charged per transaction, expressed in permille (parts per thousand). For example, 25 permille = 2.5% fee. Maximum allowed is 1000 permille (100%).',
  ADMIN_WALLETS:
    'Admin wallets have special permissions to manage this payment source, including updating configurations and handling administrative tasks. You can use default wallets or specify custom ones.',
  PURCHASING_WALLETS:
    'These wallets are used to make purchases when buying services through the Masumi Network. They hold funds that will be spent on transactions. Add multiple wallets for better fund distribution.',
  SELLING_WALLETS:
    'These wallets receive payments when you sell services through the Masumi Network. They collect revenue from your transactions. Multiple wallets help distribute incoming payments.',
  // Add more tooltip texts here as needed
} as const;

export type TooltipTextKey = keyof typeof TOOLTIP_TEXTS;
