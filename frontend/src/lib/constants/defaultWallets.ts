export interface AdminWallet {
  walletAddress: string;
  note?: string;
}

export type Network = 'Preprod' | 'Mainnet';

export const DEFAULT_ADMIN_WALLETS: Record<
  Network,
  [AdminWallet, AdminWallet, AdminWallet]
> = {
  Preprod: [
    {
      walletAddress:
        'addr_test1qr7pdg0u7vy6a5p7cx9my9m0t63f4n48pwmez30t4laguawge7xugp6m5qgr6nnp6wazurtagjva8l9fc3a5a4scx0rq2ymhl3',
      note: 'Default Preprod Admin Wallet 1',
    },
    {
      walletAddress:
        'addr_test1qplhs9snd92fmr3tzw87uujvn7nqd4ss0fn8yz7mf3y2mf3a3806uqngr7hvksqvtkmetcjcluu6xeguagwyaxevdhmsuycl5a',
      note: 'Default Preprod Admin Wallet 2',
    },
    {
      walletAddress:
        'addr_test1qzy7a702snswullyjg06j04jsulldc6yw0m4r4w49jm44f30pgqg0ez34lrdj7dy7ndp2lgv8e35e6jzazun8gekdlsq99mm6w',
      note: 'Default Preprod Admin Wallet 3',
    },
  ],
  Mainnet: [
    {
      walletAddress:
        'addr1q87pdg0u7vy6a5p7cx9my9m0t63f4n48pwmez30t4laguawge7xugp6m5qgr6nnp6wazurtagjva8l9fc3a5a4scx0rqfjxhnw',
      note: 'Default Mainnet Admin Wallet 1',
    },
    {
      walletAddress:
        'addr1q9lhs9snd92fmr3tzw87uujvn7nqd4ss0fn8yz7mf3y2mf3a3806uqngr7hvksqvtkmetcjcluu6xeguagwyaxevdhmslj9lcz',
      note: 'Default Mainnet Admin Wallet 2',
    },
    {
      walletAddress:
        'addr1qxy7a702snswullyjg06j04jsulldc6yw0m4r4w49jm44f30pgqg0ez34lrdj7dy7ndp2lgv8e35e6jzazun8gekdlsqxnxmk3',
      note: 'Default Mainnet Admin Wallet 3',
    },
  ],
};

// Also export fee wallet addresses and fee permille for each network
export const DEFAULT_FEE_CONFIG = {
  Preprod: {
    feeWalletAddress:
      'addr_test1qqfuahzn3rpnlah2ctcdjxdfl4230ygdar00qxc32guetexyg7nun6hggw9g2gpnayzf22sksr0aqdgkdcvqpc2stwtqt4u496',
    feePermille: 50, // 5% fee
  },
  Mainnet: {
    feeWalletAddress:
      'addr1qyfuahzn3rpnlah2ctcdjxdfl4230ygdar00qxc32guetexyg7nun6hggw9g2gpnayzf22sksr0aqdgkdcvqpc2stwtqgrp4f9',
    feePermille: 50, // 5% fee
  },
};
