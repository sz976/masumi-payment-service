import dotenv from 'dotenv';
dotenv.config();
if (process.env.DATABASE_URL == null)
  throw new Error('Undefined DATABASE_URL ENV variable');
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length <= 20)
  throw new Error(
    'Undefined or unsecure ENCRYPTION_KEY ENV variable. Require min 20 char',
  );

const batchPaymentInterval = Number(process.env.BATCH_PAYMENT_INTERVAL ?? '80');
if (batchPaymentInterval < 20)
  throw new Error('BATCH_PAYMENT_INTERVAL must be at least 20 seconds');
const checkTxInterval = Number(process.env.CHECK_TX_INTERVAL ?? '120');
if (checkTxInterval < 20)
  throw new Error('CHECK_TX_INTERVAL must be at least 20 seconds');
const checkCollectionInterval = Number(
  process.env.CHECK_COLLECTION_INTERVAL ?? '180',
);
if (checkCollectionInterval < 20)
  throw new Error('CHECK_COLLECTION_INTERVAL must be at least 20 seconds');
const checkCollectRefundInterval = Number(
  process.env.CHECK_COLLECT_REFUND_INTERVAL ?? '180',
);
if (checkCollectRefundInterval < 20)
  throw new Error('CHECK_COLLECT_REFUND_INTERVAL must be at least 20 seconds');
const checkSetRefundInterval = Number(
  process.env.CHECK_SET_REFUND_INTERVAL ?? '120',
);
if (checkSetRefundInterval < 20)
  throw new Error('CHECK_SET_REFUND_INTERVAL must be at least 20 seconds');
const checkUnsetRefundInterval = Number(
  process.env.CHECK_UNSET_REFUND_INTERVAL ?? '120',
);
if (checkUnsetRefundInterval < 20)
  throw new Error('CHECK_UNSET_REFUND_INTERVAL must be at least 20 seconds');
const checkWalletTransactionHashInterval = Number(
  process.env.CHECK_WALLET_TRANSACTION_HASH_INTERVAL ?? '50',
);
if (checkWalletTransactionHashInterval < 20)
  throw new Error(
    'CHECK_WALLET_TRANSACTION_HASH_INTERVAL must be at least 20 seconds',
  );
const checkAuthorizeRefundInterval = Number(
  process.env.CHECK_AUTHORIZE_REFUND_INTERVAL ?? '120',
);
if (checkAuthorizeRefundInterval < 20)
  throw new Error(
    'CHECK_AUTHORIZE_REFUND_INTERVAL must be at least 20 seconds',
  );
const checkSubmitResultInterval = Number(
  process.env.CHECK_SUBMIT_RESULT_INTERVAL ?? '120',
);
if (checkSubmitResultInterval < 20)
  throw new Error('CHECK_SUBMIT_RESULT_INTERVAL must be at least 20 seconds');
const registerAgentInterval = Number(
  process.env.REGISTER_AGENT_INTERVAL ?? '60',
);
if (registerAgentInterval < 20)
  throw new Error('REGISTER_AGENT_INTERVAL must be at least 20 seconds');
const deregisterAgentInterval = Number(
  process.env.DEREGISTER_AGENT_INTERVAL ?? '60',
);
if (deregisterAgentInterval < 20)
  throw new Error('DEREGISTER_AGENT_INTERVAL must be at least 20 seconds');

export const CONFIG = {
  PORT: process.env.PORT ?? '3001',
  DATABASE_URL: process.env.DATABASE_URL,
  BATCH_PAYMENT_INTERVAL: batchPaymentInterval, // 3 minutes in seconds
  CHECK_TX_INTERVAL: checkTxInterval, // 3 minutes in seconds
  CHECK_COLLECTION_INTERVAL: checkCollectionInterval, // 4 minutes in seconds
  CHECK_COLLECT_REFUND_INTERVAL: checkCollectRefundInterval, // 5 minutes in seconds
  CHECK_SET_REFUND_INTERVAL: checkSetRefundInterval, // 5 minutes in seconds
  CHECK_UNSET_REFUND_INTERVAL: checkUnsetRefundInterval, // 5 minutes in seconds
  CHECK_WALLET_TRANSACTION_HASH_INTERVAL: checkWalletTransactionHashInterval, // 1,5 minutes in seconds
  CHECK_AUTHORIZE_REFUND_INTERVAL: checkAuthorizeRefundInterval, // 5 minutes in seconds
  CHECK_SUBMIT_RESULT_INTERVAL: checkSubmitResultInterval, // 5 minutes in seconds
  REGISTER_AGENT_INTERVAL: registerAgentInterval, // 5 minutes in seconds
  DEREGISTER_AGENT_INTERVAL: deregisterAgentInterval, // 5 minutes in seconds
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
};

export const DEFAULTS = {
  TX_TIMEOUT_INTERVAL: 1000 * 60 * 15, // 5 minutes in seconds
  LOCK_TIMEOUT_INTERVAL: 1000 * 60 * 5, // 15 minutes in seconds
  DEFAULT_METADATA_VERSION: 1,
  DEFAULT_IMAGE: 'ipfs://QmXXW7tmBgpQpXoJMAMEXXFe9dyQcrLFKGuzxnHDnbKC7f',

  ADMIN_WALLET1_PREPROD:
    'addr_test1qr7pdg0u7vy6a5p7cx9my9m0t63f4n48pwmez30t4laguawge7xugp6m5qgr6nnp6wazurtagjva8l9fc3a5a4scx0rq2ymhl3',
  ADMIN_WALLET2_PREPROD:
    'addr_test1qplhs9snd92fmr3tzw87uujvn7nqd4ss0fn8yz7mf3y2mf3a3806uqngr7hvksqvtkmetcjcluu6xeguagwyaxevdhmsuycl5a',
  ADMIN_WALLET3_PREPROD:
    'addr_test1qzy7a702snswullyjg06j04jsulldc6yw0m4r4w49jm44f30pgqg0ez34lrdj7dy7ndp2lgv8e35e6jzazun8gekdlsq99mm6w',
  FEE_WALLET_PREPROD:
    'addr_test1qqfuahzn3rpnlah2ctcdjxdfl4230ygdar00qxc32guetexyg7nun6hggw9g2gpnayzf22sksr0aqdgkdcvqpc2stwtqt4u496',
  FEE_PERMILLE_PREPROD: 50, //equals simulated 5% fee for the network

  COOLDOWN_TIME_PREPROD: 1000 * 60 * 7,

  ADMIN_WALLET1_MAINNET:
    'addr1q87pdg0u7vy6a5p7cx9my9m0t63f4n48pwmez30t4laguawge7xugp6m5qgr6nnp6wazurtagjva8l9fc3a5a4scx0rqfjxhnw',
  ADMIN_WALLET2_MAINNET:
    'addr1q9lhs9snd92fmr3tzw87uujvn7nqd4ss0fn8yz7mf3y2mf3a3806uqngr7hvksqvtkmetcjcluu6xeguagwyaxevdhmslj9lcz',
  ADMIN_WALLET3_MAINNET:
    'addr1qxy7a702snswullyjg06j04jsulldc6yw0m4r4w49jm44f30pgqg0ez34lrdj7dy7ndp2lgv8e35e6jzazun8gekdlsqxnxmk3',
  FEE_WALLET_MAINNET:
    'addr1qyfuahzn3rpnlah2ctcdjxdfl4230ygdar00qxc32guetexyg7nun6hggw9g2gpnayzf22sksr0aqdgkdcvqpc2stwtqgrp4f9',
  FEE_PERMILLE_MAINNET: 50, //equals 5% fee for the network

  PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD:
    'addr_test1wrsr3luhqv0ftxjc6yrafw0tfesvtecrpck0s83arm0ttfqq77nu3',
  REGISTRY_POLICY_ID_PREPROD:
    '0c2912d4088fbc6a0c725dbe5233735821109bd741acfa9f13902302',
  PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET:
    'addr1w8sr3luhqv0ftxjc6yrafw0tfesvtecrpck0s83arm0ttfqmk20n5',
  REGISTRY_POLICY_ID_MAINNET:
    '01cca9f42943e3a8342dfa501f9360e3afba9bcd04c7655aa7577de1',
  COOLDOWN_TIME_MAINNET: 1000 * 60 * 7,
};
