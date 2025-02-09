import { $Enums, Prisma } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { logger } from "@/utils/logger";
import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import { mBool, resolvePaymentKeyHash } from "@meshsdk/core";
import { PlutusDatumSchema, Transaction } from "@emurgo/cardano-serialization-lib-nodejs";
import { Data } from 'lucid-cardano';



const updateMutex = new Sema(1);
export async function checkLatestTransactions() {


    const acquiredMutex = await updateMutex.tryAcquire();
    //if we are already performing an update, we wait for it to finish and return
    if (!acquiredMutex)
        return await updateMutex.acquire();

    try {
        //only support web3 cardano v1 for now
        const networkChecks = await prisma.$transaction(async (prisma) => {
            const networkChecks = await prisma.networkHandler.findMany({
                where: {
                    paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                    OR: [
                        { isSyncing: false },
                        {
                            isSyncing: true,
                            updatedAt: {
                                lte: new Date(Date.now() -
                                    //3 minutes
                                    1000 * 60 * 3
                                )
                            }
                        }
                    ]
                    //isSyncing: false
                },
                include: {
                    SellingWallets: true,
                    CollectionWallet: true
                }
            })

            if (networkChecks.length == 0) {
                logger.warn("No available network handlers found, skipping update. It could be that an other instance is already updating")
                return null;
            }


            await prisma.networkHandler.updateMany({
                where: { id: { in: networkChecks.map(x => x.id) } },
                data: { isSyncing: true }
            })
            return networkChecks.map((x) => { return { ...x, isSyncing: true } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 100000, maxWait: 10000 })
        if (networkChecks == null)
            return;
        try {
            const results = await Promise.allSettled(networkChecks.map(async (networkCheck) => {
                let latestPage = networkCheck.lastPageChecked;
                let latestIdentifier = networkCheck.lastIdentifierChecked;
                const blockfrost = new BlockFrostAPI({
                    projectId: networkCheck.rpcProviderApiKey,
                    network: networkCheck.network == $Enums.Network.MAINNET ? "mainnet" : "preprod"
                });

                let latestTx = await blockfrost.addressesTransactions(networkCheck.paymentContractAddress, { count: 25, page: networkCheck.lastPageChecked })

                while (latestTx.length > 0) {

                    const foundTxIndex = latestTx.findIndex(tx => tx.tx_hash == latestIdentifier)
                    //we already handled this transaction
                    if (foundTxIndex == latestTx.length - 1)
                        break;
                    if (foundTxIndex != -1)
                        latestTx = latestTx.slice(foundTxIndex)

                    const txData = await Promise.all(latestTx.map(async (tx) => {
                        try {
                            const cbor = await blockfrost.txsCbor(tx.tx_hash)
                            const utxos = await blockfrost.txsUtxos(tx.tx_hash)
                            const transaction = Transaction.from_bytes(Buffer.from(cbor.cbor, "hex"))
                            return { tx: tx, utxos: utxos, transaction: transaction }
                        } catch (error) {
                            //Todo handle error transactions
                            logger.warn("Error getting tx metadata, ignoring tx", { error: error, tx: tx.tx_hash })
                            return { tx, utxos: null, transaction: null };
                        }
                    }))

                    const filteredTxData = txData.filter(x => x.utxos != null && x.transaction != null)

                    for (const tx of filteredTxData) {

                        const utxos = tx.utxos
                        const inputs = utxos.inputs;
                        const outputs = utxos.outputs;

                        const valueInputs = inputs.filter((x) => { return x.address == networkCheck.paymentContractAddress })
                        const valueOutputs = outputs.filter((x) => { return x.address == networkCheck.paymentContractAddress })

                        const redeemers = tx.transaction.witness_set().redeemers();




                        if (redeemers == null) {
                            //payment transaction
                            if (valueInputs.length != 0) {
                                //invalid transaction
                                continue;
                            }

                            for (const output of valueOutputs) {
                                if (output.reference_script_hash != null) {
                                    //no reference script allowed
                                    continue
                                }
                                const outputDatum = output.inline_datum
                                if (outputDatum == null) {
                                    //invalid transaction
                                    continue;
                                }
                                const decodedOutputDatum: unknown = Data.from(outputDatum);
                                const decodedNewContract = decodeV1ContractDatum(decodedOutputDatum)
                                if (decodedNewContract == null) {
                                    //invalid transaction
                                    continue;
                                }
                                await prisma.$transaction(async (prisma) => {

                                    const databaseEntry = await prisma.purchaseRequest.findMany({
                                        where: {
                                            blockchainIdentifier: decodedNewContract.blockchainIdentifier,
                                            networkHandlerId: networkCheck.id,
                                            status: $Enums.PurchasingRequestStatus.PurchaseInitiated,
                                        },
                                        include: {
                                            SmartContractWallet: true
                                        }

                                    })
                                    if (databaseEntry.length == 0) {
                                        //transaction is not registered with us or duplicated (therefore invalid)
                                        return;
                                    }
                                    if (databaseEntry.length > 1) {
                                        //this should not be possible as uniqueness constraints are present on the database
                                        for (const entry of databaseEntry) {
                                            await prisma.purchaseRequest.update({
                                                where: { id: entry.id },
                                                data: { errorRequiresManualReview: true, errorNote: "Duplicate purchase transaction", errorType: $Enums.PaymentRequestErrorType.UNKNOWN }
                                            })
                                        }
                                        return;
                                    }
                                    const senderDb = databaseEntry[0].SmartContractWallet?.walletVkey;
                                    if (senderDb == null) {
                                        logger.error("No sender set for purchase request", { purchaseRequest: databaseEntry[0] })
                                        return;
                                    }
                                    const sender = tx.utxos.inputs.filter(x => resolvePaymentKeyHash(x.address) == senderDb)[0].address;
                                    if (sender == null) {
                                        logger.error("Sender does not match buyer", { purchaseRequest: databaseEntry[0], sender: sender, senderDb: senderDb })
                                        return;
                                    }
                                    await prisma.purchaseRequest.update({
                                        where: { id: databaseEntry[0].id },
                                        data: { status: $Enums.PurchasingRequestStatus.PurchaseConfirmed, txHash: tx.tx.tx_hash, utxo: tx.utxos.hash, potentialTxHash: null }
                                    })

                                }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000, maxWait: 10000 })
                                await prisma.$transaction(async (prisma) => {

                                    const databaseEntry = await prisma.paymentRequest.findMany({
                                        where: {
                                            blockchainIdentifier: decodedNewContract.blockchainIdentifier,
                                            networkHandlerId: networkCheck.id,
                                            status: $Enums.PaymentRequestStatus.PaymentRequested,

                                        },
                                        include: {
                                            Amounts: true,
                                            BuyerWallet: true,
                                            SmartContractWallet: true
                                        }
                                    })
                                    if (databaseEntry.length == 0) {
                                        //transaction is not registered with us or duplicated (therefore invalid)
                                        return;
                                    }

                                    if (databaseEntry.length > 1) {
                                        //this should not be possible as uniqueness constraints are present on the database
                                        for (const entry of databaseEntry) {

                                            await prisma.paymentRequest.update({
                                                where: { id: entry.id },
                                                data: {
                                                    errorRequiresManualReview: true,
                                                    errorNote: "Duplicate payment transaction",
                                                    errorType: $Enums.PaymentRequestErrorType.UNKNOWN
                                                }
                                            })
                                        }
                                        return;
                                    }
                                    const dbEntry = databaseEntry[0];
                                    if (decodedNewContract.buyer == dbEntry.BuyerWallet?.walletVkey) {
                                        logger.error("Buyer does not match buyer in db", { paymentRequest: dbEntry, buyer: decodedNewContract.buyer, buyerDb: dbEntry.BuyerWallet?.walletVkey })
                                        return;
                                    }
                                    if (decodedNewContract.seller == dbEntry.SmartContractWallet?.walletVkey) {
                                        logger.error("Seller does not match seller in db", { paymentRequest: dbEntry, seller: decodedNewContract.seller, sellerDb: dbEntry.SmartContractWallet?.walletVkey })
                                        return;
                                    }
                                    if (decodedNewContract.refundRequested != false) {
                                        logger.error("Refund was requested", { paymentRequest: dbEntry, refundRequested: decodedNewContract.refundRequested })
                                        return;
                                    }
                                    if (decodedNewContract.resultHash != null) {
                                        logger.error("Result hash was set", { paymentRequest: dbEntry, resultHash: decodedNewContract.resultHash })
                                        return;
                                    }
                                    if (decodedNewContract.resultTime != dbEntry.submitResultTime) {
                                        logger.error("Result time is not the agreed upon time", { paymentRequest: dbEntry, resultTime: decodedNewContract.resultTime, resultTimeDb: dbEntry.submitResultTime })
                                        return;
                                    }
                                    if (decodedNewContract.unlockTime < dbEntry.unlockTime) {
                                        logger.error("Unlock time is before the agreed upon time", { paymentRequest: dbEntry, unlockTime: decodedNewContract.unlockTime, unlockTimeDb: dbEntry.unlockTime })
                                        return;
                                    }
                                    if (decodedNewContract.refundTime != dbEntry.refundTime) {
                                        logger.error("Refund time is not the agreed upon time", { paymentRequest: dbEntry, refundTime: decodedNewContract.refundTime, refundTimeDb: dbEntry.refundTime })
                                        return;
                                    }

                                    const valueMatches = databaseEntry[0].Amounts.every((x) => {
                                        const existingAmount = output.amount.find((y) => y.unit == x.unit)
                                        if (existingAmount == null)
                                            return false;
                                        //allow for some overpayment to handle min lovelace requirements
                                        if (x.unit == "lovelace") {
                                            return x.amount <= BigInt(existingAmount.quantity)
                                        }
                                        //require exact match for non-lovelace amounts
                                        return x.amount == BigInt(existingAmount.quantity)
                                    })

                                    const paymentCountMatches = databaseEntry[0].Amounts.filter(x => x.unit != "lovelace").length == output.amount.filter(x => x.unit != "lovelace").length
                                    let newStatus: $Enums.PaymentRequestStatus = $Enums.PaymentRequestStatus.PaymentInvalid;

                                    if (valueMatches == true && paymentCountMatches == true) {
                                        newStatus = $Enums.PaymentRequestStatus.PaymentConfirmed
                                    }

                                    await prisma.paymentRequest.update({
                                        where: { id: databaseEntry[0].id },
                                        data: {
                                            status: newStatus,
                                            txHash: tx.tx.tx_hash,
                                            utxo: tx.utxos.hash,
                                            potentialTxHash: null,
                                            BuyerWallet: {
                                                connectOrCreate: {
                                                    where: { networkHandlerId_walletVkey: { networkHandlerId: networkCheck.id, walletVkey: decodedNewContract.buyer } },
                                                    create: { walletVkey: decodedNewContract.buyer, NetworkHandler: { connect: { id: networkCheck.id } } }
                                                }
                                            }
                                        }
                                    })
                                }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 100000, maxWait: 10000 }
                                )

                            }
                            await prisma.networkHandler.update({
                                where: { id: networkCheck.id },
                                data: { lastIdentifierChecked: tx.tx.tx_hash, lastPageChecked: latestPage }
                            })
                            latestIdentifier = tx.tx.tx_hash;
                        } else {
                            //TODO validate the contract was the one from the db

                            if (redeemers.len() != 1) {
                                //invalid transaction
                                continue;
                            }

                            if (valueInputs.length != 1) {
                                continue;
                            }
                            const valueInput = valueInputs[0];
                            if (valueInput.reference_script_hash != null) {
                                logger.error("Reference script hash is not null, this should not be allowed on a contract level", { tx: tx.tx.tx_hash })
                                //invalid transaction
                                continue;
                            }

                            const inputDatum = valueInput.inline_datum
                            if (inputDatum == null) {
                                //invalid transaction
                                continue;
                            }

                            const decodedInputDatum: unknown = Data.from(inputDatum);
                            const decodedOldContract = decodeV1ContractDatum(decodedInputDatum)
                            if (decodedOldContract == null) {
                                //invalid transaction
                                continue;
                            }

                            if (valueOutputs.length > 1) {
                                continue
                            }

                            const outputDatum = valueOutputs.length == 1 ? valueOutputs[0].inline_datum : null
                            const decodedOutputDatum = outputDatum != null ? Data.from(outputDatum) : null
                            const decodedNewContract = decodeV1ContractDatum(decodedOutputDatum)

                            const paymentRequest = await prisma.paymentRequest.findUnique({
                                where: {
                                    networkHandlerId_blockchainIdentifier: { networkHandlerId: networkCheck.id, blockchainIdentifier: decodedOldContract.blockchainIdentifier }
                                },
                                include: {
                                    BuyerWallet: true,
                                    SmartContractWallet: true,
                                    Amounts: true
                                }
                            })
                            const purchasingRequest = await prisma.purchaseRequest.findUnique({
                                where: {
                                    networkHandlerId_blockchainIdentifier_sellerWalletId: { networkHandlerId: networkCheck.id, blockchainIdentifier: decodedOldContract.blockchainIdentifier, sellerWalletId: decodedOldContract.seller }
                                },
                                include: {
                                    SmartContractWallet: true,
                                    SellerWallet: true
                                }
                            })

                            if (paymentRequest == null && purchasingRequest == null) {
                                //transaction is not registered with us or duplicated (therefore invalid)
                                continue;
                            }

                            let inputTxHashMatchPaymentRequest = paymentRequest?.txHash == valueInput.tx_hash
                            if (paymentRequest != null && inputTxHashMatchPaymentRequest == false) {
                                const utxoChain = await findPreviousUtxosForContract(valueInput.tx_hash, networkCheck.paymentContractAddress, blockfrost)
                                if (utxoChain != null) {
                                    //TODO maybe add in between tx states into the db
                                    inputTxHashMatchPaymentRequest = true;
                                }
                            }
                            let inputTxHashMatchPurchasingRequest = purchasingRequest?.txHash == valueInput.tx_hash
                            if (purchasingRequest != null && inputTxHashMatchPurchasingRequest == false) {
                                const utxoChain = await findPreviousUtxosForContract(valueInput.tx_hash, networkCheck.paymentContractAddress, blockfrost)
                                if (utxoChain != null) {
                                    //TODO maybe add in between tx states into the db
                                    inputTxHashMatchPurchasingRequest = true;
                                }
                            }
                            if (inputTxHashMatchPaymentRequest == false && inputTxHashMatchPurchasingRequest == false) {
                                logger.error("Input tx hash does not match payment request tx hash or purchasing request tx hash. This likely is a spoofing attempt", { paymentRequest: paymentRequest, purchasingRequest: purchasingRequest, txHash: valueInput.tx_hash })
                                continue;
                            }
                            const redeemer = redeemers.get(0)

                            const redeemerVersion = JSON.parse(redeemer.data().to_json(PlutusDatumSchema.BasicConversions))[
                                "constructor"
                            ]

                            if (redeemerVersion != 0 && redeemerVersion != 3 && redeemerVersion != 4 && decodedNewContract == null) {
                                //this should not be possible
                                logger.error("Possible invalid state in smart contract detected. tx_hash: " + tx.tx.tx_hash)
                                continue
                            }

                            let newStatus: $Enums.PaymentRequestStatus;
                            let newPurchasingStatus: $Enums.PurchasingRequestStatus;

                            if (redeemerVersion == 0) {
                                //Withdraw
                                newStatus = $Enums.PaymentRequestStatus.WithdrawnConfirmed
                                newPurchasingStatus = $Enums.PurchasingRequestStatus.Withdrawn
                            }
                            else if (redeemerVersion == 1) {
                                //RequestRefund
                                newStatus = $Enums.PaymentRequestStatus.RefundRequested
                                newPurchasingStatus = $Enums.PurchasingRequestStatus.RefundRequestConfirmed
                            }
                            else if (redeemerVersion == 2) {
                                //CancelRefundRequest
                                if (decodedNewContract?.resultHash) {
                                    newStatus = $Enums.PaymentRequestStatus.CompletedConfirmed
                                    newPurchasingStatus = $Enums.PurchasingRequestStatus.Completed
                                } else {
                                    //Ensure the amounts match, to prevent state change attacks
                                    const valueMatches = paymentRequest?.Amounts.every((x) => {
                                        const existingAmount = valueOutputs[0].amount.find((y) => y.unit == x.unit)
                                        if (existingAmount == null)
                                            return false;
                                        //allow for some overpayment to handle min lovelace requirements
                                        if (x.unit == "lovelace") {
                                            return x.amount <= BigInt(existingAmount.quantity)
                                        }
                                        return x.amount == BigInt(existingAmount.quantity)
                                    })
                                    newStatus = valueMatches == true ? $Enums.PaymentRequestStatus.PaymentConfirmed : $Enums.PaymentRequestStatus.PaymentInvalid;
                                    newPurchasingStatus = $Enums.PurchasingRequestStatus.PurchaseConfirmed
                                }
                            }
                            else if (redeemerVersion == 3) {
                                //WithdrawRefund
                                newStatus = $Enums.PaymentRequestStatus.Refunded
                                newPurchasingStatus = $Enums.PurchasingRequestStatus.RefundConfirmed
                            }
                            else if (redeemerVersion == 4) {
                                //WithdrawDisputed
                                newStatus = $Enums.PaymentRequestStatus.DisputedWithdrawn
                                newPurchasingStatus = $Enums.PurchasingRequestStatus.DisputedWithdrawn
                            }
                            else if (redeemerVersion == 5) {
                                //SubmitResult
                                newStatus = $Enums.PaymentRequestStatus.CompletedConfirmed
                                newPurchasingStatus = $Enums.PurchasingRequestStatus.Completed
                            }
                            else if (redeemerVersion == 6) {
                                //AllowRefund
                                newStatus = $Enums.PaymentRequestStatus.RefundRequested
                                newPurchasingStatus = $Enums.PurchasingRequestStatus.RefundRequestConfirmed
                            }
                            else {
                                //invalid transaction  
                                logger.error("Possible invalid state in smart contract detected. tx_hash: " + tx.tx.tx_hash)
                                continue;
                            }


                            await Promise.allSettled([
                                inputTxHashMatchPaymentRequest ? handlePaymentTransactionCardanoV1(tx.tx.tx_hash, tx.utxos.hash, newStatus, networkCheck.id, decodedOldContract.seller, decodedOldContract.blockchainIdentifier, redeemerVersion) : Promise.resolve(),
                                inputTxHashMatchPurchasingRequest ? handlePurchasingTransactionCardanoV1(tx.tx.tx_hash, tx.utxos.hash, newPurchasingStatus, networkCheck.id, decodedOldContract.seller, decodedOldContract.blockchainIdentifier, redeemerVersion) : Promise.resolve()
                            ])
                        }
                        await prisma.networkHandler.update({
                            where: { id: networkCheck.id },
                            data: { lastIdentifierChecked: tx.tx.tx_hash, lastPageChecked: latestPage }
                        })
                        latestIdentifier = tx.tx.tx_hash;
                    }


                    //update to the final utxo and tx hash
                    await prisma.networkHandler.update({
                        where: { id: networkCheck.id },
                        data: { lastIdentifierChecked: latestTx[latestTx.length - 1].tx_hash, lastPageChecked: latestPage }
                    })


                    if (latestTx.length >= 25) {

                        latestPage++;
                        latestTx = await blockfrost.addressesTransactions(networkCheck.paymentContractAddress, { count: 25, page: latestPage })

                    } else {
                        latestTx = []
                    }


                }

            }))

            const failedResults = results.filter(x => x.status == "rejected")
            if (failedResults.length > 0) {
                logger.error("Error updating tx data", { error: failedResults, networkChecks: networkChecks })
            }
        }
        finally {
            try {
                await prisma.networkHandler.updateMany({
                    where: { id: { in: networkChecks.map(x => x.id) } },
                    data: { isSyncing: false }
                })
            } catch (error) {
                logger.error("Error updating network checks syncing status", { error: error, networkChecks: networkChecks })
                //TODO very bad, maybe add a retry mechanism?
            }
        }
    }
    finally {
        //library is strange as we can release from any non-acquired semaphore
        updateMutex.release()
    }
}

async function handlePaymentTransactionCardanoV1(tx_hash: string, utxo_hash: string, newStatus: $Enums.PaymentRequestStatus, networkCheckId: string, sellerVkey: string, blockchainIdentifier: string, redeemerVersion: number,) {
    await prisma.$transaction(async (prisma) => {
        //we dont need to do sanity checks as the tx hash is unique
        const paymentRequest = await prisma.paymentRequest.findUnique({
            where: { networkHandlerId_blockchainIdentifier: { networkHandlerId: networkCheckId, blockchainIdentifier: blockchainIdentifier } },
        })

        if (paymentRequest == null) {
            //transaction is not registered with us or a payment transaction
            return;
        }
        const newTxHash = redeemerVersion == 0 || redeemerVersion == 3 || redeemerVersion == 4 ? null : tx_hash;


        await prisma.paymentRequest.update({
            where: { id: paymentRequest.id },
            data: { status: newStatus, txHash: newTxHash, utxo: utxo_hash, potentialTxHash: null }
        })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000, maxWait: 10000 })
}

async function findPreviousUtxosForContract(tx_hash: string, contractAddress: string, blockfrost: BlockFrostAPI, maxDepth: number = 100) {
    const utxoChain = []
    while (tx_hash != null && maxDepth > 0) {

        //find previous utxos
        const previousUtxos = await blockfrost.txsUtxos(tx_hash)
        const previousInput = previousUtxos.inputs.filter(x => x.address == contractAddress)
        if (previousInput == null) {
            return null;
        }
        if (previousInput.length > 1) {
            const found = previousInput.find(x => x.tx_hash == tx_hash)
            if (found == null) {
                //this can only be the initial payment.Therefore we can break here
                return null;
            }
            utxoChain.push(found)
            return utxoChain;
        }
        const previousInputTxHash = previousInput[0].tx_hash
        if (tx_hash == previousInputTxHash) {
            return utxoChain;
        }
        utxoChain.push(previousInputTxHash)
        tx_hash = previousInputTxHash
        maxDepth--;
    }
    throw new Error("Max depth reached");
}

async function handlePurchasingTransactionCardanoV1(tx_hash: string, utxo_hash: string, newStatus: $Enums.PurchasingRequestStatus, networkCheckId: string, sellerVkey: string, blockchainIdentifier: string, redeemerVersion: number) {
    await prisma.$transaction(async (prisma) => {
        //we dont need to do sanity checks as the tx hash is unique
        const purchasingRequest = await prisma.paymentRequest.findUnique({
            where: { networkHandlerId_blockchainIdentifier: { networkHandlerId: networkCheckId, blockchainIdentifier: blockchainIdentifier } },
        })

        if (purchasingRequest == null) {
            //transaction is not registered with us as a purchasing transaction
            return;
        }
        const newTxHash = redeemerVersion == 0 || redeemerVersion == 3 || redeemerVersion == 4 ? null : tx_hash;

        await prisma.purchaseRequest.update({
            where: { id: purchasingRequest.id },
            data: { status: newStatus, txHash: newTxHash, utxo: utxo_hash, potentialTxHash: null }
        })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000, maxWait: 10000 })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeV1ContractDatum(decodedDatum: any) {
    /*
        buyer: VerificationKeyHash,
        seller: VerificationKeyHash,
        referenceId: ByteArray,
        resultHash: ByteArray,
        result_submit_time: POSIXTime,
        unlock_time: POSIXTime,
        refund_time: POSIXTime,
        refund_requested: Bool,
    */
    if (decodedDatum == null) {
        //invalid transaction
        return null;
    }

    if (decodedDatum.fields.length != 8) {
        //invalid transaction
        return null;
    }

    if (typeof decodedDatum.fields[0] !== "string") {
        //invalid transaction
        return null;
    }
    const buyer = decodedDatum.fields[0]
    if (typeof decodedDatum.fields[1] !== "string") {
        //invalid transaction
        return null;
    }
    const seller = decodedDatum.fields[1]
    if (typeof decodedDatum.fields[2] !== "string") {
        //invalid transaction
        return null;
    }
    const blockchainIdentifier = Buffer.from(decodedDatum.fields[2], "hex").toString("utf-8")
    if (typeof decodedDatum.fields[3] !== "string") {
        //invalid transaction
        return null;
    }
    const resultHash = Buffer.from(decodedDatum.fields[3], "hex").toString("utf-8")

    if (typeof decodedDatum.fields[4] !== "number" && typeof decodedDatum.fields[4] !== "bigint") {
        //invalid transaction
        return null;
    }
    if (typeof decodedDatum.fields[5] !== "number" && typeof decodedDatum.fields[5] !== "bigint") {
        //invalid transaction
        return null;
    }
    if (typeof decodedDatum.fields[6] !== "number" && typeof decodedDatum.fields[6] !== "bigint") {
        //invalid transaction
        return null;
    }
    const resultTime = decodedDatum.fields[4]
    const unlockTime = decodedDatum.fields[5]
    const refundTime = decodedDatum.fields[6]


    const refundRequested = mBoolToBool(decodedDatum.fields[7])



    return { buyer, seller, blockchainIdentifier, resultHash, resultTime, unlockTime, refundTime, refundRequested }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mBoolToBool(value: any) {

    if (value == null) {
        return null;
    }
    if (typeof value !== "object") {
        return null;
    }
    const bFalse = mBool(false)
    const bTrue = mBool(true)

    if (value.index == bTrue.alternative && typeof value.fields == typeof bTrue.fields) {
        return true;
    }
    if (value.index == bFalse.alternative && typeof value.fields == typeof bFalse.fields) {
        return false;
    }
    return null;
}

export const cardanoTxHandlerService = { checkLatestTransactions, decodeV1ContractDatum, mBoolToBool }
