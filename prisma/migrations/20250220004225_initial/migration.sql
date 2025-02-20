-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('Active', 'Revoked');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('Read', 'ReadAndPay', 'Admin');

-- CreateEnum
CREATE TYPE "HotWalletType" AS ENUM ('Selling', 'Purchasing');

-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('Buyer', 'Seller');

-- CreateEnum
CREATE TYPE "RegistrationState" AS ENUM ('RegistrationRequested', 'RegistrationInitiated', 'RegistrationConfirmed', 'RegistrationFailed', 'DeregistrationRequested', 'DeregistrationInitiated', 'DeregistrationConfirmed', 'DeregistrationFailed');

-- CreateEnum
CREATE TYPE "PaymentErrorType" AS ENUM ('NetworkError', 'Unknown');

-- CreateEnum
CREATE TYPE "PurchaseErrorType" AS ENUM ('NetworkError', 'InsufficientFunds', 'Unknown');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('Web3CardanoV1');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('Pending', 'Confirmed', 'FailedViaTimeout');

-- CreateEnum
CREATE TYPE "OnChainState" AS ENUM ('FundsLocked', 'FundsOrDatumInvalid', 'ResultSubmitted', 'RefundRequested', 'Disputed', 'Withdrawn', 'RefundWithdrawn', 'DisputedWithdrawn');

-- CreateEnum
CREATE TYPE "PaymentAction" AS ENUM ('None', 'Ignore', 'WaitingForManualAction', 'WaitingForExternalAction', 'SubmitResultRequested', 'SubmitResultInitiated', 'WithdrawRequested', 'WithdrawInitiated', 'AuthorizeRefundRequested', 'AuthorizeRefundInitiated');

-- CreateEnum
CREATE TYPE "PurchasingAction" AS ENUM ('None', 'Ignore', 'WaitingForManualAction', 'WaitingForExternalAction', 'FundsLockingRequested', 'FundsLockingInitiated', 'SetRefundRequestedRequested', 'SetRefundRequestedInitiated', 'UnSetRefundRequestedRequested', 'UnSetRefundRequestedInitiated', 'WithdrawRefundRequested', 'WithdrawRefundInitiated');

-- CreateEnum
CREATE TYPE "Network" AS ENUM ('Preprod', 'Mainnet');

-- CreateEnum
CREATE TYPE "RPCProvider" AS ENUM ('Blockfrost');

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "status" "ApiKeyStatus" NOT NULL,
    "permission" "Permission" NOT NULL,
    "networkLimit" "Network"[],
    "usageLimited" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCredit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "unit" TEXT NOT NULL,
    "apiKeyId" TEXT,

    CONSTRAINT "UsageCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HotWallet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletVkey" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "type" "HotWalletType" NOT NULL,
    "secretId" TEXT NOT NULL,
    "collectionAddress" TEXT,
    "pendingTransactionId" TEXT,
    "paymentSourceId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "HotWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "paymentRequestHistoryId" TEXT,
    "purchaseRequestHistoryId" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletSecret" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "encryptedMnemonic" TEXT NOT NULL,

    CONSTRAINT "WalletSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletBase" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletVkey" TEXT NOT NULL,
    "note" TEXT,
    "type" "WalletType" NOT NULL,
    "paymentSourceId" TEXT NOT NULL,

    CONSTRAINT "WalletBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "paymentSourceId" TEXT NOT NULL,
    "smartContractWalletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_url" TEXT NOT NULL,
    "capability_name" TEXT NOT NULL,
    "capability_version" TEXT NOT NULL,
    "description" TEXT,
    "requests_per_hour" TEXT,
    "privacy_policy" TEXT,
    "terms" TEXT,
    "other" TEXT,
    "author_name" TEXT NOT NULL,
    "author_contact" TEXT,
    "author_organization" TEXT,
    "tags" TEXT[],
    "agentIdentifier" TEXT,
    "state" "RegistrationState" NOT NULL,
    "currentTransactionId" TEXT,

    CONSTRAINT "RegistryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPricing" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "registryRequestId" TEXT,

    CONSTRAINT "AgentPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "paymentSourceId" TEXT NOT NULL,
    "smartContractWalletId" TEXT,
    "buyerWalletId" TEXT,
    "nextActionId" TEXT NOT NULL,
    "metadata" TEXT,
    "blockchainIdentifier" TEXT NOT NULL,
    "submitResultTime" BIGINT NOT NULL,
    "unlockTime" BIGINT NOT NULL,
    "refundTime" BIGINT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "onChainState" "OnChainState",
    "sellerCoolDownTime" BIGINT NOT NULL,
    "buyerCoolDownTime" BIGINT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "currentTransactionId" TEXT,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentActionData" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requestedAction" "PaymentAction" NOT NULL,
    "resultHash" TEXT,
    "submittedTxHash" TEXT,
    "errorType" "PaymentErrorType",
    "errorNote" TEXT,

    CONSTRAINT "PaymentActionData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "paymentSourceId" TEXT NOT NULL,
    "sellerWalletId" TEXT NOT NULL,
    "smartContractWalletId" TEXT,
    "metadata" TEXT,
    "blockchainIdentifier" TEXT NOT NULL,
    "submitResultTime" BIGINT NOT NULL,
    "unlockTime" BIGINT NOT NULL,
    "refundTime" BIGINT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "onChainState" "OnChainState",
    "sellerCoolDownTime" BIGINT NOT NULL,
    "buyerCoolDownTime" BIGINT NOT NULL,
    "nextActionId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "currentTransactionId" TEXT,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseActionData" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requestedAction" "PurchasingAction" NOT NULL,
    "submittedTxHash" TEXT,
    "errorType" "PurchaseErrorType",
    "errorNote" TEXT,

    CONSTRAINT "PurchaseActionData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestAmount" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "unit" TEXT NOT NULL,
    "paymentRequestId" TEXT,
    "purchaseRequestId" TEXT,

    CONSTRAINT "RequestAmount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSource" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "network" "Network" NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "lastIdentifierChecked" TEXT,
    "syncInProgress" BOOLEAN NOT NULL DEFAULT false,
    "smartContractAddress" TEXT NOT NULL,
    "adminWalletId" TEXT NOT NULL,
    "feeRatePermille" INTEGER NOT NULL DEFAULT 50,
    "cooldownTime" INTEGER NOT NULL DEFAULT 600000,
    "paymentSourceConfigId" TEXT NOT NULL,
    "paymentType" "PaymentType" NOT NULL,

    CONSTRAINT "PaymentSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminWallet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "paymentSourceAdminId" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "AdminWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSourceConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rpcProviderApiKey" TEXT NOT NULL,
    "rpcProvider" "RPCProvider" NOT NULL,

    CONSTRAINT "PaymentSourceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_token_key" ON "ApiKey"("token");

-- CreateIndex
CREATE UNIQUE INDEX "HotWallet_pendingTransactionId_key" ON "HotWallet"("pendingTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "HotWallet_paymentSourceId_walletVkey_key" ON "HotWallet"("paymentSourceId", "walletVkey");

-- CreateIndex
CREATE UNIQUE INDEX "WalletBase_paymentSourceId_walletVkey_type_key" ON "WalletBase"("paymentSourceId", "walletVkey", "type");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryRequest_agentIdentifier_key" ON "RegistryRequest"("agentIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_nextActionId_key" ON "PaymentRequest"("nextActionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_currentTransactionId_key" ON "PaymentRequest"("currentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_paymentSourceId_blockchainIdentifier_key" ON "PaymentRequest"("paymentSourceId", "blockchainIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_nextActionId_key" ON "PurchaseRequest"("nextActionId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_currentTransactionId_key" ON "PurchaseRequest"("currentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_paymentSourceId_blockchainIdentifier_seller_key" ON "PurchaseRequest"("paymentSourceId", "blockchainIdentifier", "sellerWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSource_paymentSourceConfigId_key" ON "PaymentSource"("paymentSourceConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSource_network_smartContractAddress_key" ON "PaymentSource"("network", "smartContractAddress");

-- AddForeignKey
ALTER TABLE "UsageCredit" ADD CONSTRAINT "UsageCredit_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotWallet" ADD CONSTRAINT "HotWallet_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "WalletSecret"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotWallet" ADD CONSTRAINT "HotWallet_pendingTransactionId_fkey" FOREIGN KEY ("pendingTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotWallet" ADD CONSTRAINT "HotWallet_paymentSourceId_fkey" FOREIGN KEY ("paymentSourceId") REFERENCES "PaymentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paymentRequestHistoryId_fkey" FOREIGN KEY ("paymentRequestHistoryId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_purchaseRequestHistoryId_fkey" FOREIGN KEY ("purchaseRequestHistoryId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletBase" ADD CONSTRAINT "WalletBase_paymentSourceId_fkey" FOREIGN KEY ("paymentSourceId") REFERENCES "PaymentSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistryRequest" ADD CONSTRAINT "RegistryRequest_paymentSourceId_fkey" FOREIGN KEY ("paymentSourceId") REFERENCES "PaymentSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistryRequest" ADD CONSTRAINT "RegistryRequest_smartContractWalletId_fkey" FOREIGN KEY ("smartContractWalletId") REFERENCES "HotWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistryRequest" ADD CONSTRAINT "RegistryRequest_currentTransactionId_fkey" FOREIGN KEY ("currentTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPricing" ADD CONSTRAINT "AgentPricing_registryRequestId_fkey" FOREIGN KEY ("registryRequestId") REFERENCES "RegistryRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paymentSourceId_fkey" FOREIGN KEY ("paymentSourceId") REFERENCES "PaymentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_smartContractWalletId_fkey" FOREIGN KEY ("smartContractWalletId") REFERENCES "HotWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_buyerWalletId_fkey" FOREIGN KEY ("buyerWalletId") REFERENCES "WalletBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_nextActionId_fkey" FOREIGN KEY ("nextActionId") REFERENCES "PaymentActionData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_currentTransactionId_fkey" FOREIGN KEY ("currentTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_paymentSourceId_fkey" FOREIGN KEY ("paymentSourceId") REFERENCES "PaymentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_sellerWalletId_fkey" FOREIGN KEY ("sellerWalletId") REFERENCES "WalletBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_smartContractWalletId_fkey" FOREIGN KEY ("smartContractWalletId") REFERENCES "HotWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_nextActionId_fkey" FOREIGN KEY ("nextActionId") REFERENCES "PurchaseActionData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_currentTransactionId_fkey" FOREIGN KEY ("currentTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAmount" ADD CONSTRAINT "RequestAmount_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAmount" ADD CONSTRAINT "RequestAmount_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSource" ADD CONSTRAINT "PaymentSource_adminWalletId_fkey" FOREIGN KEY ("adminWalletId") REFERENCES "AdminWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSource" ADD CONSTRAINT "PaymentSource_paymentSourceConfigId_fkey" FOREIGN KEY ("paymentSourceConfigId") REFERENCES "PaymentSourceConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminWallet" ADD CONSTRAINT "AdminWallet_paymentSourceAdminId_fkey" FOREIGN KEY ("paymentSourceAdminId") REFERENCES "PaymentSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
