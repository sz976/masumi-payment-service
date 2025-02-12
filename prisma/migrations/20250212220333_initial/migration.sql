-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('READ', 'READ_PAY', 'ADMIN');

-- CreateEnum
CREATE TYPE "HotWalletType" AS ENUM ('SELLING', 'PURCHASING');

-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "PaymentRequestErrorType" AS ENUM ('NETWORK_ERROR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PurchaseRequestErrorType" AS ENUM ('NETWORK_ERROR', 'INSUFFICIENT_FUNDS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('WEB3_CARDANO_V1');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PaymentRequested', 'PaymentConfirmed', 'PaymentInvalid', 'ResultGenerated', 'CompletedInitiated', 'CompletedConfirmed', 'Denied', 'RefundRequested', 'Refunded', 'WithdrawnInitiated', 'WithdrawnConfirmed', 'DisputedWithdrawn');

-- CreateEnum
CREATE TYPE "PurchasingRequestStatus" AS ENUM ('PurchaseRequested', 'PurchaseInitiated', 'PurchaseConfirmed', 'Completed', 'RefundRequestInitiated', 'RefundRequestConfirmed', 'RefundInitiated', 'RefundConfirmed', 'RefundRequestCanceledInitiated', 'Withdrawn', 'DisputedWithdrawn');

-- CreateEnum
CREATE TYPE "Network" AS ENUM ('PREPROD', 'MAINNET');

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "apiKey" TEXT NOT NULL,
    "status" "ApiKeyStatus" NOT NULL,
    "permission" "Permission" NOT NULL,
    "usageLimited" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageAmount" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "unit" TEXT NOT NULL,
    "apiKeyId" TEXT,

    CONSTRAINT "UsageAmount_pkey" PRIMARY KEY ("id")
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
    "networkHandlerId" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "HotWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletSecret" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "secret" TEXT NOT NULL,

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
    "networkHandlerId" TEXT NOT NULL,

    CONSTRAINT "WalletBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "networkHandlerId" TEXT NOT NULL,
    "smartContractWalletId" TEXT,
    "buyerWalletId" TEXT,
    "currentStatusId" TEXT NOT NULL,
    "metadata" TEXT,
    "blockchainIdentifier" TEXT NOT NULL,
    "submitResultTime" BIGINT NOT NULL,
    "unlockTime" BIGINT NOT NULL,
    "refundTime" BIGINT NOT NULL,
    "requestedById" TEXT NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestStatusData" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL,
    "resultHash" TEXT,
    "cooldownTimeSeller" BIGINT,
    "cooldownTimeBuyer" BIGINT,
    "transactionId" TEXT,
    "errorType" "PaymentRequestErrorType",
    "errorNote" TEXT,
    "errorRequiresManualReview" BOOLEAN,
    "requestedById" TEXT,
    "paymentRequestId" TEXT,

    CONSTRAINT "PaymentRequestStatusData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "networkHandlerId" TEXT NOT NULL,
    "sellerWalletId" TEXT NOT NULL,
    "smartContractWalletId" TEXT,
    "metadata" TEXT,
    "blockchainIdentifier" TEXT NOT NULL,
    "submitResultTime" BIGINT NOT NULL,
    "unlockTime" BIGINT NOT NULL,
    "refundTime" BIGINT NOT NULL,
    "currentStatusId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestStatusData" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "status" "PurchasingRequestStatus" NOT NULL,
    "resultHash" TEXT,
    "cooldownTimeSeller" BIGINT,
    "cooldownTimeBuyer" BIGINT,
    "transactionId" TEXT,
    "errorType" "PurchaseRequestErrorType",
    "errorNote" TEXT,
    "errorRequiresManualReview" BOOLEAN,
    "purchaseRequestId" TEXT,
    "requestedById" TEXT,

    CONSTRAINT "PurchaseRequestStatusData_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "NetworkHandler" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "network" "Network" NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "lastIdentifierChecked" TEXT,
    "isSyncing" BOOLEAN NOT NULL DEFAULT false,
    "paymentContractAddress" TEXT NOT NULL,
    "adminWalletId" TEXT NOT NULL,
    "feePermille" INTEGER NOT NULL DEFAULT 50,
    "cooldownTime" INTEGER NOT NULL DEFAULT 600000,
    "networkHandlerConfigId" TEXT NOT NULL,
    "paymentType" "PaymentType" NOT NULL,

    CONSTRAINT "NetworkHandler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminWallet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "networkHandlerAdminId" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "AdminWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkHandlerConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rpcProviderApiKey" TEXT NOT NULL,

    CONSTRAINT "NetworkHandlerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_apiKey_key" ON "ApiKey"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "HotWallet_pendingTransactionId_key" ON "HotWallet"("pendingTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "HotWallet_networkHandlerId_walletVkey_key" ON "HotWallet"("networkHandlerId", "walletVkey");

-- CreateIndex
CREATE UNIQUE INDEX "WalletBase_networkHandlerId_walletVkey_type_key" ON "WalletBase"("networkHandlerId", "walletVkey", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_currentStatusId_key" ON "PaymentRequest"("currentStatusId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_networkHandlerId_blockchainIdentifier_key" ON "PaymentRequest"("networkHandlerId", "blockchainIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequestStatusData_paymentRequestId_timestamp_key" ON "PaymentRequestStatusData"("paymentRequestId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_currentStatusId_key" ON "PurchaseRequest"("currentStatusId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_networkHandlerId_blockchainIdentifier_selle_key" ON "PurchaseRequest"("networkHandlerId", "blockchainIdentifier", "sellerWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequestStatusData_purchaseRequestId_timestamp_key" ON "PurchaseRequestStatusData"("purchaseRequestId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkHandler_networkHandlerConfigId_key" ON "NetworkHandler"("networkHandlerConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkHandler_network_paymentContractAddress_key" ON "NetworkHandler"("network", "paymentContractAddress");

-- AddForeignKey
ALTER TABLE "UsageAmount" ADD CONSTRAINT "UsageAmount_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotWallet" ADD CONSTRAINT "HotWallet_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "WalletSecret"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotWallet" ADD CONSTRAINT "HotWallet_pendingTransactionId_fkey" FOREIGN KEY ("pendingTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotWallet" ADD CONSTRAINT "HotWallet_networkHandlerId_fkey" FOREIGN KEY ("networkHandlerId") REFERENCES "NetworkHandler"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletBase" ADD CONSTRAINT "WalletBase_networkHandlerId_fkey" FOREIGN KEY ("networkHandlerId") REFERENCES "NetworkHandler"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_networkHandlerId_fkey" FOREIGN KEY ("networkHandlerId") REFERENCES "NetworkHandler"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_smartContractWalletId_fkey" FOREIGN KEY ("smartContractWalletId") REFERENCES "HotWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_buyerWalletId_fkey" FOREIGN KEY ("buyerWalletId") REFERENCES "WalletBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_currentStatusId_fkey" FOREIGN KEY ("currentStatusId") REFERENCES "PaymentRequestStatusData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestStatusData" ADD CONSTRAINT "PaymentRequestStatusData_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestStatusData" ADD CONSTRAINT "PaymentRequestStatusData_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestStatusData" ADD CONSTRAINT "PaymentRequestStatusData_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_networkHandlerId_fkey" FOREIGN KEY ("networkHandlerId") REFERENCES "NetworkHandler"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_sellerWalletId_fkey" FOREIGN KEY ("sellerWalletId") REFERENCES "WalletBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_smartContractWalletId_fkey" FOREIGN KEY ("smartContractWalletId") REFERENCES "HotWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_currentStatusId_fkey" FOREIGN KEY ("currentStatusId") REFERENCES "PurchaseRequestStatusData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestStatusData" ADD CONSTRAINT "PurchaseRequestStatusData_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestStatusData" ADD CONSTRAINT "PurchaseRequestStatusData_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestStatusData" ADD CONSTRAINT "PurchaseRequestStatusData_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAmount" ADD CONSTRAINT "RequestAmount_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAmount" ADD CONSTRAINT "RequestAmount_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkHandler" ADD CONSTRAINT "NetworkHandler_adminWalletId_fkey" FOREIGN KEY ("adminWalletId") REFERENCES "AdminWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkHandler" ADD CONSTRAINT "NetworkHandler_networkHandlerConfigId_fkey" FOREIGN KEY ("networkHandlerConfigId") REFERENCES "NetworkHandlerConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminWallet" ADD CONSTRAINT "AdminWallet_networkHandlerAdminId_fkey" FOREIGN KEY ("networkHandlerAdminId") REFERENCES "NetworkHandler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
