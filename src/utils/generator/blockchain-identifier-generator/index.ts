import LZString from 'lz-string';

export function generateBlockchainIdentifier(
  referenceKey: string,
  referenceSignature: string,
  sellerNonce: string,
  buyerNonce: string,
) {
  const encodedBuyerNonce = Buffer.from(buyerNonce, 'utf-8').toString('hex');

  const signedEncodedBlockchainIdentifier = Buffer.from(
    sellerNonce +
      '.' +
      encodedBuyerNonce +
      '.' +
      referenceSignature +
      '.' +
      referenceKey,
  ).toString('utf-8');

  return Buffer.from(
    LZString.compressToUint8Array(signedEncodedBlockchainIdentifier),
  ).toString('hex');
}

export function decodeBlockchainIdentifier(blockchainIdentifier: string) {
  const decompressedEncodedBlockchainIdentifier =
    LZString.decompressFromUint8Array(Buffer.from(blockchainIdentifier, 'hex'));
  const blockchainIdentifierSplit =
    decompressedEncodedBlockchainIdentifier.split('.');
  if (blockchainIdentifierSplit.length != 4) {
    return null;
  }
  const sellerId = blockchainIdentifierSplit[0];
  const purchaserId = blockchainIdentifierSplit[1];
  const purchaserIdDecoded = Buffer.from(purchaserId, 'hex').toString('utf-8');

  const signature = blockchainIdentifierSplit[2];
  const key = blockchainIdentifierSplit[3];
  return {
    sellerId: sellerId,
    purchaserId: purchaserIdDecoded,
    signature: signature,
    key: key,
  };
}
