import { mBool } from "@meshsdk/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decodeV1ContractDatum(decodedDatum: any) {
    /*
        buyer: VerificationKeyHash,
        seller: VerificationKeyHash,
        referenceId: ByteArray,
        resultHash: ByteArray,
        result_submit_time: POSIXTime,
        unlock_time: POSIXTime,
        refund_time: POSIXTime,
        refund_requested: Bool,
        seller_cooldown_time: POSIXTime,
        buyer_cooldown_time: POSIXTime,

    */

    if (decodedDatum == null) {
        //invalid transaction
        return null;
    }
    let fields = decodedDatum.fields
    let values = decodedDatum.value

    if (fields.length != 10 && values.length != 10) {
        //invalid transaction
        return null;
    }
    fields = fields.length == 10 ? fields : values

    if (typeof fields[0] !== "string") {
        //invalid transaction
        return null;
    }
    const buyer = fields[0]
    if (typeof fields[1] !== "string") {
        //invalid transaction
        return null;
    }
    const seller = fields[1]
    if (typeof fields[2] !== "string") {
        //invalid transaction
        return null;
    }
    const blockchainIdentifier = Buffer.from(fields[2], "hex").toString("utf-8")
    if (typeof fields[3] !== "string") {
        //invalid transaction
        return null;
    }
    const resultHash = Buffer.from(fields[3], "hex").toString("utf-8")

    if (typeof fields[4] !== "number" && typeof fields[4] !== "bigint") {
        //invalid transaction
        return null;
    }
    if (typeof fields[5] !== "number" && typeof fields[5] !== "bigint") {
        //invalid transaction
        return null;
    }
    if (typeof fields[6] !== "number" && typeof fields[6] !== "bigint") {
        //invalid transaction
        return null;
    }
    const resultTime = fields[4]
    const unlockTime = fields[5]
    const refundTime = fields[6]


    const refundRequested = mBoolToBool(fields[7])
    if (refundRequested == null) {
        //invalid transaction
        return null;
    }

    if (typeof fields[8] !== "number" && typeof fields[8] !== "bigint") {
        //invalid transaction
        return null;
    }
    const buyerCooldownTime = fields[8]

    if (typeof fields[9] !== "number" && typeof fields[9] !== "bigint") {
        //invalid transaction
        return null;
    }
    const sellerCooldownTime = fields[9]

    const newCooldownTime = Date.now() + 1000 * 60 * 20;

    return { buyer, seller, blockchainIdentifier, resultHash, resultTime, unlockTime, refundTime, refundRequested, buyerCooldownTime, sellerCooldownTime, newCooldownTime }
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
