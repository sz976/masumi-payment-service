import { payAuthenticatedEndpointFactory } from '@/utils/security/auth/pay-authenticated';
import { z } from 'zod';
import { HotWalletType, Network, PricingType } from '@prisma/client';
import { prisma } from '@/utils/db';
import createHttpError from 'http-errors';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { getRegistryScriptFromNetworkHandlerV1 } from '@/utils/generator/contract-generator';
import { metadataToString } from '@/utils/converter/metadata-string-convert';
import { DEFAULTS } from '@/utils/config';
import { checkIsAllowedNetworkOrThrowUnauthorized } from '@/utils/middleware/auth-middleware';

const metadataSchema = z.object({
  name: z
    .string()
    .min(1)
    .or(z.array(z.string().min(1))),
  description: z.string().or(z.array(z.string())).optional(),
  api_url: z
    .string()
    .min(1)
    .url()
    .or(z.array(z.string().min(1))),
  example_output: z.string().or(z.array(z.string())).optional(),
  capability: z.object({
    name: z.string().or(z.array(z.string())),
    version: z.string().or(z.array(z.string())),
  }),
  requests_per_hour: z.string().or(z.array(z.string())).optional(),
  author: z.object({
    name: z
      .string()
      .min(1)
      .or(z.array(z.string().min(1))),
    contact: z.string().or(z.array(z.string())).optional(),
    organization: z.string().or(z.array(z.string())).optional(),
  }),
  legal: z
    .object({
      privacy_policy: z.string().or(z.array(z.string())).optional(),
      terms: z.string().or(z.array(z.string())).optional(),
      other: z.string().or(z.array(z.string())).optional(),
    })
    .optional(),
  tags: z.array(z.string().min(1)).min(1),
  AgentPricing: z.object({
    pricingType: z.enum([PricingType.Fixed]),
    Pricing: z
      .array(
        z.object({
          amount: z.number({ coerce: true }).int().min(1),
          unit: z
            .string()
            .min(1)
            .or(z.array(z.string().min(1))),
        }),
      )
      .min(1)
      .max(5),
  }),
  image: z.string().or(z.array(z.string())),
  metadata_version: z.number({ coerce: true }).int().min(1).max(1),
});

export const queryAgentFromWalletSchemaInput = z.object({
  walletVKey: z
    .string()
    .max(250)
    .describe('The payment key of the wallet to be queried'),
  network: z
    .nativeEnum(Network)
    .describe('The Cardano network used to register the agent on'),
  smartContractAddress: z
    .string()
    .max(250)
    .optional()
    .describe(
      'The smart contract address of the payment source to which the registration belongs',
    ),
});

export const queryAgentFromWalletSchemaOutput = z.object({
  assets: z.array(
    z.object({
      policyId: z.string(),
      assetName: z.string(),
      agentIdentifier: z.string(),
      metadata: z.object({
        name: z.string().max(250),
        description: z.string().max(250).nullable().optional(),
        apiUrl: z.string().max(250),
        exampleOutput: z.string().max(250).nullable().optional(),
        tags: z.array(z.string().max(250)),
        requestsPerHour: z.string().max(250).nullable().optional(),
        capability: z.object({
          name: z.string().max(250),
          version: z.string().max(250),
        }),
        author: z.object({
          name: z.string().max(250),
          contact: z.string().max(250).nullable().optional(),
          organization: z.string().max(250).nullable().optional(),
        }),
        legal: z
          .object({
            privacyPolicy: z.string().max(250).nullable().optional(),
            terms: z.string().max(250).nullable().optional(),
            other: z.string().max(250).nullable().optional(),
          })
          .nullable()
          .optional(),
        AgentPricing: z.object({
          pricingType: z.enum([PricingType.Fixed]),
          Pricing: z
            .array(
              z.object({
                amount: z.string(),
                unit: z.string().max(250),
              }),
            )
            .min(1),
        }),
        image: z.string().max(250),
        metadataVersion: z.number({ coerce: true }).int().min(1).max(1),
      }),
    }),
  ),
});

export const queryAgentFromWalletGet = payAuthenticatedEndpointFactory.build({
  method: 'get',
  input: queryAgentFromWalletSchemaInput,
  output: queryAgentFromWalletSchemaOutput,
  handler: async ({ input, options }) => {
    const smartContractAddress =
      input.smartContractAddress ??
      (input.network == Network.Mainnet
        ? DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_MAINNET
        : DEFAULTS.PAYMENT_SMART_CONTRACT_ADDRESS_PREPROD);
    const paymentSource = await prisma.paymentSource.findUnique({
      where: {
        network_smartContractAddress: {
          network: input.network,
          smartContractAddress: smartContractAddress,
        },
      },
      include: { PaymentSourceConfig: true, HotWallets: true },
    });
    if (paymentSource == null) {
      throw createHttpError(
        404,
        'Network and Address combination not supported',
      );
    }
    await checkIsAllowedNetworkOrThrowUnauthorized(
      options.networkLimit,
      input.network,
      options.permission,
    );
    const blockfrost = new BlockFrostAPI({
      projectId: paymentSource.PaymentSourceConfig.rpcProviderApiKey,
    });
    const wallet = paymentSource.HotWallets.find(
      (wallet) =>
        wallet.walletVkey == input.walletVKey &&
        wallet.type == HotWalletType.Selling,
    );
    if (wallet == null) {
      throw createHttpError(404, 'Wallet not found');
    }
    const { policyId } =
      await getRegistryScriptFromNetworkHandlerV1(paymentSource);

    const addressInfo = await blockfrost.addresses(wallet.walletAddress);
    if (addressInfo.stake_address == null) {
      throw createHttpError(404, 'Stake address not found');
    }
    const stakeAddress = addressInfo.stake_address;

    const holderWallet =
      await blockfrost.accountsAddressesAssetsAll(stakeAddress);
    if (!holderWallet || holderWallet.length == 0) {
      throw createHttpError(404, 'Asset not found');
    }
    const assets = holderWallet.filter((asset) =>
      asset.unit.startsWith(policyId),
    );
    const detailedAssets: {
      unit: string;
      metadata: z.infer<
        typeof queryAgentFromWalletSchemaOutput
      >['assets'][0]['metadata'];
    }[] = [];

    await Promise.all(
      assets.map(async (asset) => {
        const assetInfo = await blockfrost.assetsById(asset.unit);
        const parsedMetadata = metadataSchema.safeParse(
          assetInfo.onchain_metadata,
        );
        if (!parsedMetadata.success) {
          return;
        }
        detailedAssets.push({
          unit: asset.unit,
          metadata: {
            name: metadataToString(parsedMetadata.data.name!)!,
            description: metadataToString(parsedMetadata.data.description),
            apiUrl: metadataToString(parsedMetadata.data.api_url)!,
            exampleOutput: metadataToString(parsedMetadata.data.example_output),
            capability: {
              name: metadataToString(parsedMetadata.data.capability.name)!,
              version: metadataToString(
                parsedMetadata.data.capability.version,
              )!,
            },
            author: {
              name: metadataToString(parsedMetadata.data.author.name)!,
              contact: metadataToString(parsedMetadata.data.author.contact),
              organization: metadataToString(
                parsedMetadata.data.author.organization,
              ),
            },
            legal: parsedMetadata.data.legal
              ? {
                  privacyPolicy: metadataToString(
                    parsedMetadata.data.legal.privacy_policy,
                  ),
                  terms: metadataToString(parsedMetadata.data.legal.terms),
                  other: metadataToString(parsedMetadata.data.legal.other),
                }
              : undefined,
            tags: parsedMetadata.data.tags.map((tag) => metadataToString(tag)!),
            AgentPricing: {
              pricingType: parsedMetadata.data.AgentPricing.pricingType,
              Pricing: parsedMetadata.data.AgentPricing.Pricing.map(
                (price) => ({
                  amount: price.amount.toString(),
                  unit: metadataToString(price.unit)!,
                }),
              ),
            },
            image: metadataToString(parsedMetadata.data.image)!,
            metadataVersion: parsedMetadata.data.metadata_version,
          },
        });
      }),
    );

    return {
      assets: detailedAssets.map((asset) => ({
        policyId: policyId,
        assetName: asset.unit.slice(policyId.length),
        agentIdentifier: asset.unit,
        metadata: asset.metadata,
      })),
    };
  },
});
