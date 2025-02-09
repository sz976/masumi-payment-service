import { Network, PaymentType, PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { MeshWallet, resolvePaymentKeyHash, resolvePlutusScriptAddress, resolveStakeKeyHash, PlutusScript, applyParamsToScript } from '@meshsdk/core'
import { encrypt } from './../src/utils/security/encryption';
import { DEFAULTS } from './../src/utils/config';
import { getRegistryScriptV1 } from './../src/utils/generator/contract-generator';

dotenv.config();
const prisma = new PrismaClient();
export const seed = async (prisma: PrismaClient) => {

  const adminKey = process.env.ADMIN_KEY;
  if (adminKey != null) {
    if (adminKey.length < 15) throw Error('API-KEY is insecure');

    await prisma.apiKey.upsert({
      create: { apiKey: adminKey, permission: 'ADMIN', status: 'ACTIVE' },
      update: { apiKey: adminKey, permission: 'ADMIN', status: 'ACTIVE' },
      where: { apiKey: adminKey },
    });

    console.log('ADMIN_KEY seeded');
  } else {
    console.log('ADMIN_KEY is not seeded. Provide ADMIN_KEY in .env');
  }


  let collectionWalletPreprodAddress = process.env.COLLECTION_WALLET_PREPROD_ADDRESS;
  let purchaseWalletPreprodMnemonic = process.env.PURCHASE_WALLET_PREPROD_MNEMONIC;
  if (!purchaseWalletPreprodMnemonic) {
    const secret_key = MeshWallet.brew(false) as string[];
    purchaseWalletPreprodMnemonic = secret_key.join(" ");
  }
  let sellingWalletPreprodMnemonic = process.env.SELLING_WALLET_PREPROD_MNEMONIC;
  if (!sellingWalletPreprodMnemonic) {
    const secret_key = MeshWallet.brew(false) as string[];
    sellingWalletPreprodMnemonic = secret_key.join(" ");
  }
  if (!collectionWalletPreprodAddress) {
    const sellingWallet = new MeshWallet({
      networkId: 0,
      key: {
        type: 'mnemonic',
        words: sellingWalletPreprodMnemonic.split(" "),
      },
    });
    collectionWalletPreprodAddress = (await sellingWallet.getUnusedAddresses())[0];
  }

  let collectionWalletMainnetAddress = process.env.COLLECTION_WALLET_MAINNET_ADDRESS;
  let purchaseWalletMainnetMnemonic = process.env.PURCHASE_WALLET_MAINNET_MNEMONIC;
  if (!purchaseWalletMainnetMnemonic) {
    const secret_key = MeshWallet.brew(false) as string[];
    purchaseWalletMainnetMnemonic = secret_key.join(" ");
  }
  let sellingWalletMainnetMnemonic = process.env.SELLING_WALLET_MAINNET_MNEMONIC;
  if (!sellingWalletMainnetMnemonic) {
    const secret_key = MeshWallet.brew(false) as string[];
    sellingWalletMainnetMnemonic = secret_key.join(" ");
  }
  if (!collectionWalletMainnetAddress) {
    const sellingWallet = new MeshWallet({
      networkId: 0,
      key: {
        type: 'mnemonic',
        words: sellingWalletMainnetMnemonic.split(" "),
      },
    });
    collectionWalletMainnetAddress = (await sellingWallet.getUnusedAddresses())[0];
  }


  const blockfrostApiKeyPreprod = process.env.BLOCKFROST_API_KEY_PREPROD;

  const encryptionKey = process.env.ENCRYPTION_KEY;

  const adminWallet1AddressPreprod = DEFAULTS.ADMIN_WALLET1_PREPROD;
  const adminWallet2AddressPreprod = DEFAULTS.ADMIN_WALLET2_PREPROD;
  const adminWallet3AddressPreprod = DEFAULTS.ADMIN_WALLET3_PREPROD;

  const feeWalletAddressPreprod = DEFAULTS.FEE_WALLET_PREPROD;
  const feePermillePreprod = DEFAULTS.FEE_PERMILLE_PREPROD;


  const scriptJSON = readFileSync('./smart-contracts/payment/plutus.json', 'utf-8');

  if (encryptionKey != null && blockfrostApiKeyPreprod != null) {

    const blueprint = JSON.parse(scriptJSON)

    const fee = feePermillePreprod
    if (fee < 0 || fee > 1000) throw Error("Fee permille is not valid")


    const script: PlutusScript = {
      code: applyParamsToScript(blueprint.validators[0].compiledCode, [
        2,
        [
          resolvePaymentKeyHash(adminWallet1AddressPreprod),
          resolvePaymentKeyHash(adminWallet2AddressPreprod),
          resolvePaymentKeyHash(adminWallet3AddressPreprod),
        ],
        {
          alternative: 0,
          fields: [
            {
              alternative: 0,
              fields: [resolvePaymentKeyHash(feeWalletAddressPreprod)],
            },
            {
              alternative: 0,
              fields: [
                {
                  alternative: 0,
                  fields: [
                    {
                      alternative: 0,
                      fields: [resolveStakeKeyHash(feeWalletAddressPreprod)],
                    },
                  ],
                },
              ],
            },
          ],
        },
        fee,
      ]),
      version: "V3"
    };
    const smartContractAddress = resolvePlutusScriptAddress(script, 0)

    try {
      const purchasingWallet = new MeshWallet({
        networkId: 0,
        key: {
          type: 'mnemonic',
          words: purchaseWalletPreprodMnemonic.split(" "),
        },
      });
      const sellingWallet = new MeshWallet({
        networkId: 0,
        key: {
          type: 'mnemonic',
          words: sellingWalletPreprodMnemonic.split(" "),
        },
      });
      await prisma.networkHandler.create({
        data: {
          paymentContractAddress: smartContractAddress,
          network: Network.PREPROD,
          rpcProviderApiKey: blockfrostApiKeyPreprod,
          paymentType: PaymentType.WEB3_CARDANO_V1,
          isSyncing: true,
          FeeReceiverNetworkWallet: {
            create: {
              walletAddress: adminWallet1AddressPreprod,
              order: 1,
            },
          },
          feePermille: fee,
          AdminWallets: {
            create: [
              { walletAddress: adminWallet1AddressPreprod, order: 1 },
              { walletAddress: adminWallet2AddressPreprod, order: 2 },
              { walletAddress: adminWallet3AddressPreprod, order: 3 },
            ],
          },
          PurchasingWallets: {
            create: {
              walletVkey: resolvePaymentKeyHash((await purchasingWallet.getUnusedAddresses())[0]),
              walletAddress: (await purchasingWallet.getUnusedAddresses())[0],
              note: "Created by seeding",
              WalletSecret: { create: { secret: encrypt(purchaseWalletPreprodMnemonic) } }
            }
          },
          SellingWallets: {
            create: {
              walletVkey: resolvePaymentKeyHash((await sellingWallet.getUnusedAddresses())[0]),
              walletAddress: (await sellingWallet.getUnusedAddresses())[0],
              note: "Created by seeding",
              WalletSecret: { create: { secret: encrypt(sellingWalletPreprodMnemonic) } }
            }
          },
          CollectionWallet: {
            create: {
              walletAddress: collectionWalletPreprodAddress,
              note: "Created by seeding",
            }
          }
        },
      });
      const { policyId } = await getRegistryScriptV1(smartContractAddress, Network.PREPROD)
      console.log('Network check for contract on preprod: ' + smartContractAddress + ' added. Registry policyId: ' + policyId);
    } catch (error) {
      console.error(error);
    }
  } else {
    console.log("Smart contract preprod to monitor is not seeded. Provide ENCRYPTION_KEY and BLOCKFROST_API_KEY_PREPROD in .env")
  }

  const blockfrostApiKeyMainnet = process.env.BLOCKFROST_API_KEY_MAINNET;
  const adminWallet1AddressMainnet = DEFAULTS.ADMIN_WALLET1_MAINNET;
  const adminWallet2AddressMainnet = DEFAULTS.ADMIN_WALLET2_MAINNET;
  const adminWallet3AddressMainnet = DEFAULTS.ADMIN_WALLET3_MAINNET;

  const feeWalletAddressMainnet = DEFAULTS.FEE_WALLET_MAINNET;
  const feePermilleMainnet = DEFAULTS.FEE_PERMILLE_MAINNET;

  if (encryptionKey != null && blockfrostApiKeyMainnet != null) {

    const blueprint = JSON.parse(scriptJSON)

    const fee = feePermilleMainnet
    if (fee < 0 || fee > 1000) throw Error("Fee permille is not valid")


    const script: PlutusScript = {
      code: applyParamsToScript(blueprint.validators[0].compiledCode, [
        2,
        [
          resolvePaymentKeyHash(adminWallet1AddressMainnet),
          resolvePaymentKeyHash(adminWallet2AddressMainnet),
          resolvePaymentKeyHash(adminWallet3AddressMainnet),
        ],
        {
          alternative: 0,
          fields: [
            {
              alternative: 0,
              fields: [resolvePaymentKeyHash(feeWalletAddressMainnet)],
            },
            {
              alternative: 0,
              fields: [
                {
                  alternative: 0,
                  fields: [
                    {
                      alternative: 0,
                      fields: [resolveStakeKeyHash(feeWalletAddressMainnet)],
                    },
                  ],
                },
              ],
            },
          ],
        },
        fee,
      ]),
      version: "V3"
    };

    const smartContractAddress = resolvePlutusScriptAddress(script, 1)

    try {
      const purchasingWallet = new MeshWallet({
        networkId: 1,
        key: {
          type: 'mnemonic',
          words: purchaseWalletMainnetMnemonic.split(" "),
        },
      });
      const sellingWallet = new MeshWallet({
        networkId: 1,
        key: {
          type: 'mnemonic',
          words: sellingWalletMainnetMnemonic.split(" "),
        },
      });
      await prisma.networkHandler.create({
        data: {
          paymentContractAddress: smartContractAddress,
          network: Network.MAINNET,
          rpcProviderApiKey: blockfrostApiKeyMainnet,
          paymentType: PaymentType.WEB3_CARDANO_V1,
          isSyncing: true,
          FeeReceiverNetworkWallet: {
            create: {
              walletAddress: adminWallet1AddressMainnet,
              order: 1,
            },
          },
          feePermille: fee,
          AdminWallets: {
            create: [
              { walletAddress: adminWallet1AddressMainnet, order: 1 },
              { walletAddress: adminWallet2AddressMainnet, order: 2 },
              { walletAddress: adminWallet3AddressMainnet, order: 3 },
            ],
          },
          PurchasingWallets: {
            create: {
              walletVkey: resolvePaymentKeyHash((await purchasingWallet.getUnusedAddresses())[0]),
              walletAddress: (await purchasingWallet.getUnusedAddresses())[0],
              note: "Created by seeding",
              WalletSecret: { create: { secret: encrypt(purchaseWalletMainnetMnemonic) } }
            }
          },
          SellingWallets: {
            create: {
              walletVkey: resolvePaymentKeyHash((await sellingWallet.getUnusedAddresses())[0]),
              walletAddress: (await sellingWallet.getUnusedAddresses())[0],
              note: "Created by seeding",
              WalletSecret: { create: { secret: encrypt(sellingWalletMainnetMnemonic) } }
            }
          },
          CollectionWallet: {
            create: {
              walletAddress: collectionWalletMainnetAddress,
              note: "Created by seeding",
            }
          }
        },
      });
      const { policyId } = await getRegistryScriptV1(smartContractAddress, Network.MAINNET)
      console.log('Network check for contract on mainnet: ' + smartContractAddress + ' added. Registry policyId: ' + policyId);
    } catch (error) {
      console.error(error);
    }
  } else {
    console.log("Smart contract mainnet to monitor is not seeded. Provide ENCRYPTION_KEY and BLOCKFROST_API_KEY_MAINNET in .env")
  }

};
seed(prisma)
  .then(() => {
    prisma.$disconnect();
    console.log('Seed completed');
  })
  .catch((e) => {
    prisma.$disconnect();
    console.error(e);
  });
