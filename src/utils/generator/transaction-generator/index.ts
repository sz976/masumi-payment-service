import {
  Asset,
  Data,
  IFetcher,
  LanguageVersion,
  MeshTxBuilder,
  Network,
  UTxO,
} from '@meshsdk/core';
import { resolvePlutusScriptAddress } from '@meshsdk/core-cst';

export async function generateMasumiSmartContractInteractionTransaction(
  type: 'AuthorizeRefund' | 'CancelRefund' | 'RequestRefund' | 'SubmitResult',
  blockchainProvider: IFetcher,
  network: Network,
  script: {
    version: LanguageVersion;
    code: string;
  },
  walletAddress: string,
  smartContractUtxo: UTxO,
  collateralUtxo: UTxO,
  walletUtxos: UTxO[],
  newInlineDatum: Data,
  invalidBefore: number,
  invalidAfter: number,
  exUnits: {
    mem: number;
    steps: number;
  } = {
    mem: 7e6,
    steps: 3e9,
  },
) {
  const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
  });
  const redeemerData = generateRedeemerData(type);

  const deserializedAddress =
    txBuilder.serializer.deserializer.key.deserializeAddress(walletAddress);
  txBuilder
    .spendingPlutusScript(script.version)
    .txIn(
      smartContractUtxo.input.txHash,
      smartContractUtxo.input.outputIndex,
      smartContractUtxo.output.amount,
      smartContractUtxo.output.address,
      smartContractUtxo.output.scriptRef
        ? smartContractUtxo.output.scriptRef.length / 2
        : 0,
    )
    .txInScript(script.code) // ,script.version)
    .txInRedeemerValue(redeemerData, 'Mesh', exUnits)
    .txInInlineDatumPresent()
    .txInCollateral(
      collateralUtxo.input.txHash,
      collateralUtxo.input.outputIndex,
    )
    .setTotalCollateral('5000000')
    .txOut(
      resolvePlutusScriptAddress(script, 0),
      smartContractUtxo.output.amount,
    )
    .txOutInlineDatumValue(newInlineDatum);

  for (const utxo of walletUtxos) {
    txBuilder.txIn(utxo.input.txHash, utxo.input.outputIndex);
  }

  return await txBuilder
    .changeAddress(walletAddress)
    .invalidBefore(invalidBefore)
    .invalidHereafter(invalidAfter)
    .requiredSignerHash(deserializedAddress.pubKeyHash)
    .setNetwork(network)
    .metadataValue(674, {
      msg: ['Masumi', type],
    })
    .complete();
}

function generateRedeemerData(
  type:
    | 'AuthorizeRefund'
    | 'CancelRefund'
    | 'RequestRefund'
    | 'SubmitResult'
    | 'CollectCompleted'
    | 'CollectRefund',
) {
  switch (type) {
    case 'AuthorizeRefund':
      return {
        alternative: 6,
        fields: [],
      };
    case 'CancelRefund':
      return {
        alternative: 2,
        fields: [],
      };
    case 'RequestRefund':
      return {
        alternative: 1,
        fields: [],
      };
    case 'SubmitResult':
      return {
        alternative: 5,
        fields: [],
      };
    case 'CollectCompleted':
      return {
        alternative: 0,
        fields: [],
      };
    case 'CollectRefund':
      return {
        alternative: 3,
        fields: [],
      };
  }
}

export async function generateMasumiSmartContractWithdrawTransaction(
  type: 'CollectCompleted' | 'CollectRefund',
  blockchainProvider: IFetcher,
  network: Network,
  script: {
    version: LanguageVersion;
    code: string;
  },
  walletAddress: string,
  smartContractUtxo: UTxO,
  collateralUtxo: UTxO,
  walletUtxos: UTxO[],
  collection: {
    collectAssets: Asset[];
    collectionAddress: string;
  },
  fee: {
    feeAssets: Asset[];
    feeAddress: string;
  } | null,
  invalidBefore: number,
  invalidAfter: number,
  exUnits: {
    mem: number;
    steps: number;
  } = {
    mem: 7e6,
    steps: 3e9,
  },
) {
  const txBuilder = new MeshTxBuilder({
    fetcher: blockchainProvider,
  });
  const redeemerData = generateRedeemerData(type);

  const deserializedAddress =
    txBuilder.serializer.deserializer.key.deserializeAddress(walletAddress);
  txBuilder
    .spendingPlutusScript(script.version)
    .txIn(
      smartContractUtxo.input.txHash,
      smartContractUtxo.input.outputIndex,
      smartContractUtxo.output.amount,
      smartContractUtxo.output.address,
      smartContractUtxo.output.scriptRef
        ? smartContractUtxo.output.scriptRef.length / 2
        : 0,
    )
    .txInScript(script.code) // ,script.version)
    .txInRedeemerValue(redeemerData, 'Mesh', exUnits)
    .txInInlineDatumPresent()
    .txInCollateral(
      collateralUtxo.input.txHash,
      collateralUtxo.input.outputIndex,
    )
    .setTotalCollateral('5000000')
    .txOut(collection.collectionAddress, collection.collectAssets);

  for (const utxo of walletUtxos) {
    txBuilder.txIn(utxo.input.txHash, utxo.input.outputIndex);
  }

  if (fee) {
    txBuilder.txOut(fee.feeAddress, fee.feeAssets);
  }

  return await txBuilder
    .changeAddress(walletAddress)
    .invalidBefore(invalidBefore)
    .invalidHereafter(invalidAfter)
    .requiredSignerHash(deserializedAddress.pubKeyHash)
    .setNetwork(network)
    .metadataValue(674, {
      msg: ['Masumi', type],
    })
    .complete();
}
