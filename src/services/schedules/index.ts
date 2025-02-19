import { logger } from "../../utils/logger";
import { CONFIG } from "../../utils/config";
import { checkLatestTransactions } from "../cardano-tx-handler/cardano-tx-handler.service";
import { batchLatestPaymentEntriesV1 } from "../cardano-payment-batcher/cardano-payment-batcher.service";
import { collectOutstandingPaymentsV1 } from "../cardano-collection-handler/cardano-collection-handler.service";
import { collectRefundV1 } from "../cardano-refund-handler/cardano-collection-refund.service";
import { updateWalletTransactionHashHandlerService } from "../update-wallet-transaction-hash-handler/update-wallet-transaction-hash-handler.service";
import { requestRefundsV1 } from "../cardano-request-refund-handler/cardano-request-refund-handler.service";
import { AsyncInterval } from "../../utils/async-interval";

async function initJobs() {
    const start = new Date();
    await new Promise(resolve => setTimeout(resolve, 500));
    await checkLatestTransactions();
    logger.info("Checked and synced transactions in " + (new Date().getTime() - start.getTime()) / 1000 + "s");

    new Promise(resolve => setTimeout(resolve, 750)).then(() => {
        // Batch payments interval
        AsyncInterval.start(async () => {
            logger.info("Starting to pay batched payments");
            const start = new Date();
            await batchLatestPaymentEntriesV1();
            logger.info("Finished to pay batched payments in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
        }, CONFIG.BATCH_PAYMENT_INTERVAL * 1000); // Convert seconds to milliseconds
    });

    new Promise(resolve => setTimeout(resolve, 5000)).then(() => {
        // Check collections interval
        AsyncInterval.start(async () => {
            logger.info("Starting to collect outstanding payments");
            const start = new Date();
            await collectOutstandingPaymentsV1();
            logger.info("Finished to collect outstanding payments in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
        }, CONFIG.CHECK_COLLECTION_INTERVAL * 1000); // Convert seconds to milliseconds
    });

    new Promise(resolve => setTimeout(resolve, 10000)).then(() => {
        // Check collection and refund interval
        AsyncInterval.start(async () => {
            logger.info("Starting to collect refunds");
            const start = new Date();
            await collectRefundV1();
            logger.info("Finished to collect refunds in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
        }, CONFIG.CHECK_COLLECT_REFUND_INTERVAL * 1000); // Convert seconds to milliseconds
    });

    new Promise(resolve => setTimeout(resolve, 15000)).then(() => {
        // Check refund interval
        AsyncInterval.start(async () => {
            logger.info("Starting to collect timed out refunds");
            const start = new Date();
            await requestRefundsV1();
            logger.info("Finished to collect timed out refunds in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
        }, CONFIG.CHECK_REFUND_INTERVAL * 1000); // Convert seconds to milliseconds
    });

    new Promise(resolve => setTimeout(resolve, 20000)).then(() => {
        // Check wallet transaction hash interval
        AsyncInterval.start(async () => {
            logger.info("Starting to check for wallet transactions and wallets to unlock");
            const start = new Date();
            await updateWalletTransactionHashHandlerService.updateWalletTransactionHash();
            logger.info("Finished to check for wallet transactions and wallets to unlock in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
        }, CONFIG.CHECK_WALLET_TRANSACTION_HASH_INTERVAL * 1000); // Convert seconds to milliseconds
    });
    new Promise(resolve => setTimeout(resolve, 2500)).then(() => {
        // Check transactions interval
        AsyncInterval.start(async () => {
            logger.info("Starting to sync cardano payment entries");
            const start = new Date();
            await checkLatestTransactions();
            logger.info("Finished to sync cardano payment entries in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
        }, CONFIG.CHECK_TX_INTERVAL * 1000); // Convert seconds to milliseconds
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    logger.info("Initialized async intervals")
}

export {
    initJobs,
};
