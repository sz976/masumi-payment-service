import { logger } from "../../utils/logger";
import { CONFIG } from "../../utils/config";
import { checkLatestTransactions } from "../cardano-tx-handler/cardano-tx-handler.service";
import { batchLatestPaymentEntriesV1 } from "../cardano-payment-batcher/cardano-payment-batcher.service";
import { collectOutstandingPaymentsV1 } from "../cardano-collection-handler/cardano-collection-handler.service";
import { collectRefundV1 } from "../cardano-refund-handler/cardano-collection-refund.service";
import { updateWalletTransactionHashHandlerService } from "../update-wallet-transaction-hash-handler/update-wallet-transaction-hash-handler.service";
import { collectTimeoutRefundsV1 } from "../cardano-collect-timeout-refund-handler/cardano-collect-timeout-refund-handler.service";
import { AsyncInterval } from "../../utils/async-interval";

async function initJobs() {
    logger.log({
        level: "info",
        message: "initialized async intervals",
    });
    await new Promise(resolve => setTimeout(resolve, 1500));
    // Check transactions interval
    AsyncInterval.start(async () => {
        logger.info("updating cardano payment entries");
        const start = new Date();
        await checkLatestTransactions();
        logger.info("finished updating cardano payment entries in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
    }, CONFIG.CHECK_TX_INTERVAL * 1000); // Convert seconds to milliseconds

    await new Promise(resolve => setTimeout(resolve, 5000));
    // Batch payments interval
    AsyncInterval.start(async () => {
        logger.info("batching payments");
        const start = new Date();
        await batchLatestPaymentEntriesV1();
        logger.info("finished batching payments in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
    }, CONFIG.BATCH_PAYMENT_INTERVAL * 1000); // Convert seconds to milliseconds

    await new Promise(resolve => setTimeout(resolve, 5000));
    // Check collections interval
    AsyncInterval.start(async () => {
        logger.info("checking for payments to collect");
        const start = new Date();
        await collectOutstandingPaymentsV1();
        logger.info("finished checking payments to collect in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
    }, CONFIG.CHECK_COLLECTION_INTERVAL * 1000); // Convert seconds to milliseconds

    await new Promise(resolve => setTimeout(resolve, 5000));
    // Check collection and refund interval
    AsyncInterval.start(async () => {
        logger.info("checking for payments to collect and refund");
        const start = new Date();
        await collectRefundV1();
        logger.info("finished checking payments to collect in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
    }, CONFIG.CHECK_COLLECT_REFUND_INTERVAL * 1000); // Convert seconds to milliseconds

    await new Promise(resolve => setTimeout(resolve, 5000));
    // Check refund interval
    AsyncInterval.start(async () => {
        logger.info("checking for payments to refund");
        const start = new Date();
        await collectRefundV1();
        await collectTimeoutRefundsV1();
        logger.info("finished checking payments to refund in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
    }, CONFIG.CHECK_REFUND_INTERVAL * 1000); // Convert seconds to milliseconds

    await new Promise(resolve => setTimeout(resolve, 5000));
    // Check wallet transaction hash interval
    AsyncInterval.start(async () => {
        logger.info("checking for wallet transaction hash");
        const start = new Date();
        await updateWalletTransactionHashHandlerService.updateWalletTransactionHash();
        logger.info("finished checking wallet transaction hash in " + (new Date().getTime() - start.getTime()) / 1000 + "s");
    }, CONFIG.CHECK_WALLET_TRANSACTION_HASH_INTERVAL * 1000); // Convert seconds to milliseconds
}

export {
    initJobs,
};
