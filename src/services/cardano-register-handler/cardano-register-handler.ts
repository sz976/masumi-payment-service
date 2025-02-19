import { TransactionStatus, HotWalletType, RegistrationState } from "@prisma/client";
import { Sema } from "async-sema";
import { prisma } from '@/utils/db';
import { Transaction } from "@meshsdk/core";
import { logger } from "@/utils/logger";
import { convertNetwork, } from "@/utils/converter/network-convert";
import { generateWalletExtended } from "@/utils/generator/wallet-generator";
import { lockAndQueryRegistryRequests } from "@/utils/db/lock-and-query-registry-request";
import { DEFAULTS } from "@/utils/config";
import { getRegistryScriptFromNetworkHandlerV1 } from "@/utils/generator/contract-generator";
import { blake2b } from "ethereum-cryptography/blake2b";
import { stringToMetadata } from "@/utils/converter/metadata-string-convert";

const updateMutex = new Sema(1);

export async function registerAgentV1() {

    const acquiredMutex = await updateMutex.tryAcquire();
    //if we are already performing an update, we wait for it to finish and return
    if (!acquiredMutex)
        return await updateMutex.acquire();

    try {
        //Submit a result for invalid tokens
        const paymentSourcesWithWalletLocked = await lockAndQueryRegistryRequests(
            {
                state: RegistrationState.RegistrationRequested
            }
        )

        await Promise.allSettled(paymentSourcesWithWalletLocked.map(async (paymentSource) => {

            if (paymentSource.RegistryRequest.length == 0)
                return;

            const network = convertNetwork(paymentSource.network)

            const registryRequests = paymentSource.RegistryRequest;

            if (registryRequests.length == 0)
                return;
            //we can only allow one transaction per wallet
            const deDuplicatedRequests: ({ Pricing: { id: string; createdAt: Date; updatedAt: Date; unit: string; quantity: bigint; registryRequestId: string | null; }[]; SmartContractWallet: ({ Secret: { id: string; createdAt: Date; updatedAt: Date; encryptedMnemonic: string; }; } & { id: string; createdAt: Date; updatedAt: Date; walletVkey: string; walletAddress: string; type: HotWalletType; secretId: string; collectionAddress: string | null; pendingTransactionId: string | null; paymentSourceId: string; lockedAt: Date | null; note: string | null; }) | null; } & { name: string; id: string; createdAt: Date; updatedAt: Date; paymentSourceId: string; lastCheckedAt: Date | null; state: RegistrationState; smartContractWalletId: string | null; api_url: string; capability_name: string; capability_version: string; description: string | null; requests_per_hour: string | null; privacy_policy: string | null; terms: string | null; other: string | null; author_name: string; author_contact: string | null; author_organization: string | null; tags: string[]; agentIdentifier: string | null; currentTransactionId: string | null; })[] = []
            for (const request of registryRequests) {
                if (request.smartContractWalletId == null || request.SmartContractWallet == null)
                    continue;
                if (deDuplicatedRequests.some(r => r.smartContractWalletId == request.smartContractWalletId))
                    continue;

                deDuplicatedRequests.push(request);
            }

            await Promise.allSettled(deDuplicatedRequests.map(async (request) => {
                if (request.SmartContractWallet == null)
                    return;
                const { wallet, utxos, address } = await generateWalletExtended(paymentSource.network, paymentSource.PaymentSourceConfig.rpcProviderApiKey, request.SmartContractWallet.Secret.encryptedMnemonic)

                if (utxos.length === 0) {
                    throw new Error('No UTXOs found for the wallet');
                }
                const { script, policyId } = await getRegistryScriptFromNetworkHandlerV1(paymentSource)

                const firstUtxo = utxos[0];
                //utxos = utxos.filter((_, index) => index !== filteredUtxos);

                const txId = firstUtxo.input.txHash;
                const txIndex = firstUtxo.input.outputIndex;
                const serializedOutput = txId + txIndex.toString(16).padStart(8, '0');

                const serializedOutputUint8Array = new Uint8Array(
                    Buffer.from(serializedOutput.toString(), 'hex'),
                );
                // Hash the serialized output using blake2b_256
                const blake2b256 = blake2b(serializedOutputUint8Array, 32);
                const assetName = Buffer.from(blake2b256).toString('hex');

                const redeemer = {
                    data: { alternative: 0, fields: [] },
                    tag: 'MINT',
                };


                const tx = new Transaction({ initiator: wallet }).setMetadata(674, {
                    msg: ["Masumi", "RegisterAgent"],
                }).setTxInputs([
                    //ensure our first utxo hash (serializedOutput) is used as first input
                    firstUtxo,
                    ...utxos.slice(1),
                ]);

                tx.isCollateralNeeded = true;

                //setup minting data separately as the minting function does not work well with hex encoded strings without some magic
                tx.txBuilder
                    .mintPlutusScript(script.version)
                    .mint('1', policyId, assetName)
                    .mintingScript(script.code)
                    .mintRedeemerValue(redeemer.data, 'Mesh');



                //setup the metadata
                tx.setMetadata(721, {
                    [policyId]: {
                        [assetName]: {
                            name: stringToMetadata(request.name),
                            description: stringToMetadata(request.description),
                            api_url: stringToMetadata(request.api_url),
                            example_output: stringToMetadata(request.other),
                            capability: {
                                name: stringToMetadata(request.capability_name),
                                version: stringToMetadata(request.capability_version)
                            },
                            requests_per_hour: stringToMetadata(request.requests_per_hour),
                            author: {
                                name: stringToMetadata(request.author_name),
                                contact: stringToMetadata(request.author_contact),
                                organization: stringToMetadata(request.author_organization)
                            },
                            legal: {
                                privacy_policy: stringToMetadata(request.privacy_policy),
                                terms: stringToMetadata(request.terms),
                                other: stringToMetadata(request.other)
                            },
                            tags: request.tags,
                            pricing: request.Pricing.map(pricing => ({
                                unit: stringToMetadata(pricing.unit),
                                quantity: pricing.quantity,
                            })),
                            image: stringToMetadata(DEFAULTS.DEFAULT_IMAGE),
                            metadata_version: stringToMetadata(DEFAULTS.DEFAULT_METADATA_VERSION)

                        },
                    },
                    version: "1"
                });
                //send the minted asset to the address where we want to receive payments
                tx.sendAssets(address, [{ unit: policyId + assetName, quantity: '1' }])
                tx.sendLovelace(address, "5000000")
                //sign the transaction with our address
                tx.setChangeAddress(address).setRequiredSigners([address]);

                //build the transaction
                const unsignedTx = await tx.build();
                const signedTx = await wallet.signTx(unsignedTx, true);


                await prisma.registryRequest.update({
                    where: { id: request.id }, data: {
                        state: RegistrationState.RegistrationInitiated,
                        agentIdentifier: policyId + assetName
                    }
                })
                //submit the transaction to the blockchain
                const newTxHash = await wallet.submitTx(signedTx);
                await prisma.registryRequest.update({
                    where: { id: request.id }, data: {
                        CurrentTransaction: {
                            create: {
                                txHash: newTxHash,
                                status: TransactionStatus.Pending,
                                BlocksWallet: {
                                    connect: {
                                        id: request.SmartContractWallet!.id
                                    }
                                }
                            }
                        }
                    }
                })

                logger.info(`Created withdrawal transaction:
                  Tx ID: ${newTxHash}
                  View (after a bit) on https://${network === 'preprod'
                        ? 'preprod.'
                        : ''
                    }cardanoscan.io/transaction/${newTxHash}
              `);

            }))
        }))

    }
    catch (error) {
        logger.error("Error submitting result", { error: error })
    }
    finally {
        //library is strange as we can release from any non-acquired semaphore
        updateMutex.release()
    }
}

export const cardanoRegisterHandlerService = { registerAgentV1 }
