import dotenv from 'dotenv';
dotenv.config();
if (process.env.DATABASE_URL == null)
    throw new Error("Undefined DATABASE_URL ENV variable")
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length <= 20)
    throw new Error("Undefined or unsecure ENCRYPTION_KEY ENV variable. Require min 20 char")

export const CONFIG = {
    PORT: process.env.PORT ?? "3001",
    DATABASE_URL: process.env.DATABASE_URL,
    BATCH_PAYMENT_INTERVAL: process.env.BATCH_PAYMENT_INTERVAL ?? "*/4 * * * *",
    CHECK_TX_INTERVAL: process.env.CHECK_TX_INTERVAL ?? "*/3 * * * *",
    CHECK_COLLECTION_INTERVAL: process.env.CHECK_COLLECTION_INTERVAL ?? "*/5 * * * *",
    CHECK_COLLECT_REFUND_INTERVAL: process.env.CHECK_COLLECT_REFUND_INTERVAL ?? "*/5 * * * *",
    CHECK_REFUND_INTERVAL: process.env.CHECK_REFUND_INTERVAL ?? "*/5 * * * *",
    CHECK_DENY_INTERVAL: process.env.CHECK_DENY_INTERVAL ?? "*/5 * * * *",
    CHECK_WALLET_TRANSACTION_HASH_INTERVAL: process.env.CHECK_WALLET_TRANSACTION_HASH_INTERVAL ?? "*/1 * * * *",
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
};

export const DEFAULTS = {
    ADMIN_WALLET1_PREPROD: "addr_test1qr7pdg0u7vy6a5p7cx9my9m0t63f4n48pwmez30t4laguawge7xugp6m5qgr6nnp6wazurtagjva8l9fc3a5a4scx0rq2ymhl3",
    ADMIN_WALLET2_PREPROD: "addr_test1qplhs9snd92fmr3tzw87uujvn7nqd4ss0fn8yz7mf3y2mf3a3806uqngr7hvksqvtkmetcjcluu6xeguagwyaxevdhmsuycl5a",
    ADMIN_WALLET3_PREPROD: "addr_test1qzy7a702snswullyjg06j04jsulldc6yw0m4r4w49jm44f30pgqg0ez34lrdj7dy7ndp2lgv8e35e6jzazun8gekdlsq99mm6w",
    FEE_WALLET_PREPROD: "addr_test1qqfuahzn3rpnlah2ctcdjxdfl4230ygdar00qxc32guetexyg7nun6hggw9g2gpnayzf22sksr0aqdgkdcvqpc2stwtqt4u496",
    FEE_PERMILLE_PREPROD: 50, //equals simulated 5% fee for the network
    PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD: "addr_test1wqarcz6uad8l44dkmmtllud2amwc9t0xa6l5mv2t7tq4szgagm7r2",
    REGISTRY_POLICY_ID_PREPROD: "398a61a6bc4d51cc90b2a5710dbc2818013fc41ad428c2e4ba09b006",

    ADMIN_WALLET1_MAINNET: "addr1q87pdg0u7vy6a5p7cx9my9m0t63f4n48pwmez30t4laguawge7xugp6m5qgr6nnp6wazurtagjva8l9fc3a5a4scx0rqfjxhnw",
    ADMIN_WALLET2_MAINNET: "addr1q9lhs9snd92fmr3tzw87uujvn7nqd4ss0fn8yz7mf3y2mf3a3806uqngr7hvksqvtkmetcjcluu6xeguagwyaxevdhmslj9lcz",
    ADMIN_WALLET3_MAINNET: "addr1qxy7a702snswullyjg06j04jsulldc6yw0m4r4w49jm44f30pgqg0ez34lrdj7dy7ndp2lgv8e35e6jzazun8gekdlsqxnxmk3",
    FEE_WALLET_MAINNET: "addr1qyfuahzn3rpnlah2ctcdjxdfl4230ygdar00qxc32guetexyg7nun6hggw9g2gpnayzf22sksr0aqdgkdcvqpc2stwtqgrp4f9",
    FEE_PERMILLE_MAINNET: 50, //equals 5% fee for the network
    PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET: "addr1wyarcz6uad8l44dkmmtllud2amwc9t0xa6l5mv2t7tq4szgxq0zv0",
    REGISTRY_POLICY_ID_MAINNET: "fbd41ebabfed0fd1565f024b11d278dbf03b471a17a5578c79b50edb",
}