/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { SmartContractState } from '@/utils/generator/contract-generator';
import { logger } from '@/utils/logger';

export function decodeV1ContractDatum(decodedDatum: any) {
  try {
    if (decodedDatum == null) {
      //invalid transaction
      return null;
    }
    const fields = decodedDatum.fields;

    if (fields?.length != 11) {
      //invalid transaction
      return null;
    }

    if (fields[0] == null || !fields[0].bytes) {
      //invalid transaction
      return null;
    }
    const buyer = fields[0].bytes;

    if (fields[1] == null || fields[1].bytes == null) {
      //invalid transaction
      return null;
    }
    const seller = fields[1].bytes;

    if (fields[2] == null || fields[2].bytes == null) {
      //invalid transaction
      return null;
    }

    const blockchainIdentifier = Buffer.from(fields[2].bytes, 'hex').toString(
      'utf-8',
    );
    if (fields[3] == null || fields[3].bytes == null) {
      //invalid transaction
      return null;
    }
    //decode as base64
    const inputHash = Buffer.from(
      Buffer.from(fields[3].bytes, 'hex').toString('utf-8'),
      'base64',
    ).toString('utf-8');
    if (fields[4] == null || fields[4].bytes == null) {
      //invalid transaction
      return null;
    }
    //decode as base64
    const resultHash = Buffer.from(
      Buffer.from(fields[4].bytes, 'hex').toString('utf-8'),
      'base64',
    ).toString('utf-8');

    if (fields[5] == null || fields[5].int == null) {
      //invalid transaction
      return null;
    }
    if (fields[6] == null || fields[6].int == null) {
      //invalid transaction
      return null;
    }
    if (fields[7] == null || fields[7].int == null) {
      //invalid transaction
      return null;
    }
    const resultTime = parseInt(fields[5].int);
    const unlockTime = parseInt(fields[6].int);
    const externalDisputeUnlockTime = parseInt(fields[7].int);

    if (fields[8] == null || fields[8].int == null) {
      //invalid transaction
      return null;
    }
    const buyerCooldownTime = parseInt(fields[8].int);

    if (fields[9] == null || fields[9].int == null) {
      //invalid transaction
      return null;
    }
    const sellerCooldownTime = parseInt(fields[9].int);

    const state = valueToStatus(fields[10]);
    if (state == null) {
      //invalid transaction
      return null;
    }

    return {
      buyer: buyer as string,
      seller: seller as string,
      state,
      blockchainIdentifier,
      inputHash,
      resultHash,
      resultTime,
      unlockTime,
      externalDisputeUnlockTime,
      buyerCooldownTime,
      sellerCooldownTime,
    };
  } catch (error) {
    logger.warn('Error decoding v1 contract datum', { error: error });
    return null;
  }
}
export function newCooldownTime(cooldownTime: number) {
  //We add some additional cooldown time to avoid validity issues with blocktime
  const cooldownTimeMs = Date.now() + cooldownTime + 1000 * 60 * 10;
  return cooldownTimeMs;
}

function valueToStatus(value: any) {
  if (value == null) {
    return null;
  }
  if (
    value.constructor == null ||
    value.fields == null ||
    value.fields.length != 0
  ) {
    return null;
  }
  const constructor = value.constructor;
  switch (constructor) {
    case 0n:
    case 0:
      return SmartContractState.FundsLocked;
    case 1n:
    case 1:
      return SmartContractState.ResultSubmitted;
    case 2n:
    case 2:
      return SmartContractState.RefundRequested;
    case 3n:
    case 3:
      return SmartContractState.Disputed;
  }
  return null;
}
