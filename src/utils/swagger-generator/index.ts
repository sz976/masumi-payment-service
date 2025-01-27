import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { healthResponseSchema } from '@/routes/api/health';
import { addAPIKeySchemaInput, addAPIKeySchemaOutput, deleteAPIKeySchemaInput, deleteAPIKeySchemaOutput, getAPIKeySchemaInput, getAPIKeySchemaOutput, updateAPIKeySchemaInput, updateAPIKeySchemaOutput } from '@/routes/api/api-key';
import { $Enums } from '@prisma/client';
import { createPaymentSchemaOutput, createPaymentsSchemaInput, queryPaymentsSchemaInput, queryPaymentsSchemaOutput, updatePaymentSchemaOutput, updatePaymentsSchemaInput } from '@/routes/api/payments';
import { createPurchaseInitSchemaInput, createPurchaseInitSchemaOutput, queryPurchaseRequestSchemaInput, queryPurchaseRequestSchemaOutput, refundPurchaseSchemaInput, refundPurchaseSchemaOutput } from '@/routes/api/purchases';
import { paymentSourceCreateSchemaInput, paymentSourceCreateSchemaOutput, paymentSourceDeleteSchemaInput, paymentSourceDeleteSchemaOutput, paymentSourceSchemaInput, paymentSourceSchemaOutput, paymentSourceUpdateSchemaInput, paymentSourceUpdateSchemaOutput } from '@/routes/api/payment-source';
import { registerAgentSchemaInput, registerAgentSchemaOutput, unregisterAgentSchemaInput, unregisterAgentSchemaOutput } from '@/routes/api/registry';
import { getAPIKeyStatusSchemaOutput, } from '@/routes/api/api-key-status';
import { getWalletSchemaInput, getWalletSchemaOutput, postWalletSchemaInput, postWalletSchemaOutput } from '@/routes/api/wallet';
import { getRpcProviderKeysSchemaInput, getRpcProviderKeysSchemaOutput } from '@/routes/api/rpc-api-keys';
import { getUTXOSchemaInput, getUTXOSchemaOutput } from '@/routes/api/utxos';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
export function generateOpenAPI() {
  /********************* HEALTH *****************************/
  registry.registerPath({
    method: 'get',
    path: '/health/',
    tags: ['health',],
    summary: 'Get the status of the API server',
    request: {},
    responses: {
      200: {
        description: 'Object with user data.',
        content: {
          'application/json': {
            schema: healthResponseSchema.openapi({ example: { status: 'up' } }),
          },
        },
      },
    },
  });




  const apiKeyAuth = registry.registerComponent('securitySchemes', 'API-Key', {
    type: 'apiKey',
    in: 'header',
    name: 'token',
    description: 'API key authentication via header (token)',
  });


  /********************* KEY STATUS *****************************/
  registry.registerPath({
    method: 'get',
    path: '/api-key-status/',
    description: 'Gets api key status',
    summary: 'REQUIRES API KEY Authentication (+READ)',
    tags: ['api-key-status',],
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'API key status',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: getAPIKeyStatusSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  status: "ACTIVE",
                  apiKey: "masumi_payment_api_key_secret",
                  permission: $Enums.Permission.ADMIN,
                  usageLimited: true,
                  RemainingUsageCredits: [{ unit: "lovelcae", amount: 1000000 }],
                }
              }
            }),
          },
        },
      },
    },
  });


  /********************* WALLET *****************************/
  registry.registerPath({
    method: 'get',
    path: '/wallet/',
    description: 'Gets wallet status',
    summary: 'REQUIRES API KEY Authentication (+ADMIN)',
    tags: ['wallet',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: getWalletSchemaInput.openapi({
        example: {
          id: "unique_cuid_v2_of_entry_to_delete",
          includeSecret: "true",
          walletType: "Selling",
        }
      })
    },
    responses: {
      200: {
        description: 'Wallet status',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: getWalletSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  walletVkey: "wallet_vkey",
                  note: "note",
                  PendingTransaction: null,
                  walletAddress: "wallet_address",
                  WalletSecret: {
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    secret: "decoded_secret",
                  }
                }
              }
            }),
          },
        },
      },
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/wallet/',
    description: 'Creates a wallet, it will not be saved in the database, please ensure to remember the mnemonic',
    summary: 'REQUIRES API KEY Authentication (+ADMIN)',
    tags: ['wallet',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: postWalletSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD,
              }
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Wallet created',
        content: {
          'application/json': {
            schema: postWalletSchemaOutput.openapi({
              example: {
                walletMnemonic: "wallet_mnemonic",
                walletAddress: "wallet_address",
                walletVkey: "wallet_vkey",
              }
            }),
          },
        },
      },
    },
  });
  /********************* API KEYS *****************************/
  registry.registerPath({
    method: 'get',
    path: '/api-key/',
    description: 'Gets api key status',
    summary: 'REQUIRES API KEY Authentication (+admin)',
    tags: ['api-key',],
    request: {
      query: getAPIKeySchemaInput.openapi({
        example: {
          limit: 10,
          cursorApiKey: "identifier",
        }
      })
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'Api key status',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: getAPIKeySchemaOutput }).openapi({
              example: {
                data: {
                  apiKeys: [{
                    apiKey: "masumi_payment_api_key_secret",
                    permission: "ADMIN",
                    usageLimited: true,
                    RemainingUsageCredits: [{ unit: "lovelace", amount: 1000000 }],
                    status: "ACTIVE"
                  }]
                }, status: "success"
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api-key/',
    description: 'Creates a API key',
    summary: 'REQUIRES API KEY Authentication (+admin)',
    tags: ['api-key',],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: addAPIKeySchemaInput.openapi({
              example: {
                usageLimited: "true",
                UsageCredits: [{ unit: "lovelace", amount: 1000000 }],
                permission: $Enums.Permission.ADMIN
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'API key deleted',
        content: {
          'application/json': {
            schema: z.object({ data: addAPIKeySchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_of_entry_to_delete",
                  apiKey: "masumi_payment_api_key_secret",
                  permission: $Enums.Permission.ADMIN,
                  usageLimited: true,
                  status: $Enums.ApiKeyStatus.ACTIVE,
                }
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api-key/',
    description: 'Creates a API key',
    summary: 'REQUIRES API KEY Authentication (+admin)',
    tags: ['api-key',],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: updateAPIKeySchemaInput.openapi({
              example: {
                id: "id_or_apiKey_unique_cuid_v2_of_entry_to_update",
                apiKey: "id_or_apiKey_api_key_to_update",
                UsageCredits: [{ unit: "lovelace", amount: 1000000 }],
                status: $Enums.ApiKeyStatus.ACTIVE
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'API key deleted',
        content: {
          'application/json': {
            schema: z.object({ data: updateAPIKeySchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_of_entry_to_delete",
                  apiKey: "masumi_payment_api_key_secret",
                  permission: $Enums.Permission.ADMIN,
                  usageLimited: true,
                  status: $Enums.ApiKeyStatus.ACTIVE,
                }
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api-key/',
    description: 'Removes a API key',
    summary: 'REQUIRES API KEY Authentication (+admin)',
    tags: ['api-key',],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: deleteAPIKeySchemaInput.openapi({
              example: {
                id: "id_or_apiKey_unique_cuid_v2_of_entry_to_delete",
                apiKey: "id_or_apiKey_api_key_to_delete",
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'API key deleted',
        content: {
          'application/json': {
            schema: z.object({ data: deleteAPIKeySchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_of_entry_to_delete",
                  apiKey: "masumi_registry_api_key_secret",
                }
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });

  /********************* PAYMENT *****************************/
  registry.registerPath({
    method: 'get',
    path: '/payment/',
    description: 'Gets the payment status. It needs to be created first with a POST request.',
    summary: 'REQUIRES API KEY Authentication (+READ)',
    tags: ['payment',],
    request: {
      query: queryPaymentsSchemaInput.openapi({
        example: {
          limit: 10,
          cursorIdentifier: "identifier",
          network: $Enums.Network.PREPROD,
          paymentContractAddress: "addr_abcd1234567890"
        }
      })
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'Payment status',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: queryPaymentsSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  payments: [{
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    status: $Enums.PaymentRequestStatus.PaymentRequested,
                    txHash: "tx_hash",
                    utxo: "utxo",
                    errorType: $Enums.PaymentRequestErrorType.NETWORK_ERROR,
                    errorNote: "error_note",
                    errorRequiresManualReview: false,
                    identifier: "identifier",
                    BuyerWallet: { walletVkey: "wallet_vkey" },
                    SmartContractWallet: { id: "unique_cuid_v2_auto_generated", walletAddress: "wallet_address", walletVkey: "wallet_vkey", note: "note" },
                    Amounts: [{ id: "unique_cuid_v2_auto_generated", createdAt: new Date(), updatedAt: new Date(), amount: 1000000, unit: "unit" }],
                    NetworkHandler: { id: "unique_cuid_v2_auto_generated", network: $Enums.Network.PREPROD, paymentContractAddress: "address_to_check", paymentType: $Enums.PaymentType.WEB3_CARDANO_V1 },
                  }]
                },
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/payment/',
    description: 'Creates a payment request and identifier. This will check incoming payments in the background.',
    summary: 'REQUIRES API KEY Authentication (+PAY)',
    tags: ['payment',],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: createPaymentsSchemaInput.openapi({
              example: {
                agentIdentifier: "agent_identifier",
                network: $Enums.Network.PREPROD,
                paymentContractAddress: "address",
                amounts: [{ amount: 1000000, unit: "lovelace" }],
                paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                submitResultTime: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'Payment request created',
        content: {
          'application/json': {
            schema: z.object({ data: createPaymentSchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_auto_generated",
                  identifier: "agent_identifier_unique_cuid_v2_auto_generated",
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  status: $Enums.PaymentRequestStatus.PaymentRequested,
                }
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/payment/',
    description: 'Completes a payment request. This will collect the funds after the unlock time.',
    summary: 'REQUIRES API KEY Authentication (+PAY)',
    tags: ['payment',],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: updatePaymentsSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD,
                paymentContractAddress: "address",
                hash: "hash",
                identifier: "identifier",
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'API key deleted',
        content: {
          'application/json': {
            schema: z.object({ data: updatePaymentSchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_auto_generated",
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  status: $Enums.PaymentRequestStatus.PaymentRequested,
                }
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });


  /********************* PURCHASE *****************************/
  registry.registerPath({
    method: 'get',
    path: '/purchase/',
    description: 'Gets the purchase status. It needs to be created first with a POST request.',
    summary: 'REQUIRES API KEY Authentication (+READ)',
    tags: ['purchase',],
    request: {
      query: queryPurchaseRequestSchemaInput.openapi({
        example: {
          limit: 10,
          cursorIdentifier: "identifier",
          cursorIdentifierSellingWalletVkey: "wallet_vkey",
          network: $Enums.Network.PREPROD,
          paymentContractAddress: "addr_abcd1234567890",
        }
      })
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'Purchase status',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: queryPurchaseRequestSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  purchases: [{
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    status: $Enums.PurchasingRequestStatus.PurchaseRequested,
                    txHash: "tx_hash",
                    utxo: "utxo",
                    errorType: $Enums.PurchaseRequestErrorType.NETWORK_ERROR,
                    errorNote: "error_note",
                    errorRequiresManualReview: false,
                    identifier: "identifier",
                    SmartContractWallet: { id: "unique_cuid_v2_auto_generated", walletAddress: "wallet_address", walletVkey: "wallet_vkey", note: "note" },
                    Amounts: [{ id: "unique_cuid_v2_auto_generated", createdAt: new Date(), updatedAt: new Date(), amount: 1000000, unit: "lovelace" }],
                    NetworkHandler: { id: "unique_cuid_v2_auto_generated", network: $Enums.Network.PREPROD, paymentContractAddress: "address_to_check", paymentType: $Enums.PaymentType.WEB3_CARDANO_V1 },
                    SellerWallet: { walletVkey: "wallet_vkey", note: "note" },
                  }],
                }
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/purchase/',
    description: 'Creates a purchase and pays the seller. This requires funds to be available.',
    summary: 'REQUIRES API KEY Authentication (+PAY)',
    tags: ['purchase',],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: createPurchaseInitSchemaInput.openapi({
              example: {
                identifier: "identifier",
                network: $Enums.Network.PREPROD,
                sellerVkey: "seller_vkey",
                paymentContractAddress: "address",
                amounts: [{ amount: 1000000, unit: "lovelace" }],
                paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                submitResultTime: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
                unlockTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
                refundTime: new Date(Date.now() + 1000 * 60 * 60 * 36).toISOString(),
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'Purchase request created',
        content: {
          'application/json': {
            schema: z.object({ data: createPurchaseInitSchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_auto_generated",
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  status: $Enums.PurchasingRequestStatus.PurchaseRequested,
                }
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/purchase/',
    description: 'Requests a refund for a completed purchase. This will collect the refund after the refund time.',
    summary: 'REQUIRES API KEY Authentication (+PAY)',
    tags: ['purchase',],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: refundPurchaseSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD,
                paymentContractAddress: "address",
                identifier: "identifier",
              }
            })
          }
        }
      }
    },
    security: [{ [apiKeyAuth.name]: [] }],
    responses: {
      200: {
        description: 'API key deleted',
        content: {
          'application/json': {
            schema: z.object({ data: refundPurchaseSchemaOutput, status: z.string() }).openapi({
              example: {
                status: "success",
                data: {
                  txHash: "tx_hash",
                }
              }
            }),
          },
        },
      },
      400: {
        description: 'Bad Request (possible parameters missing or invalid)',
      },
      401: {
        description: 'Unauthorized',
      },
      500: {
        description: 'Internal Server Error',
      }
    },
  });

  /********************* REGISTRY *****************************/
  registry.registerPath({
    method: 'post',
    path: '/registry/',
    description: 'Registers an agent to the registry.',
    summary: 'REQUIRES API KEY Authentication (+PAY)',
    tags: ['registry',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: registerAgentSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD,
                paymentContractAddress: "addr_test1",
                tags: ["tag1", "tag2"],
                name: "Agent Name",
                api_url: "https://api.example.com",
                description: "Agent Description",
                author: {
                  name: "Author Name",
                  contact: "author@example.com",
                  organization: "Author Organization"
                },
                legal: {
                  privacy_policy: "Privacy Policy URL",
                  terms: "Terms of Service URL",
                  other: "Other Legal Information URL"
                },
                sellingWalletVkey: "wallet_vkey",
                capability: { name: "Capability Name", version: "1.0.0" },
                requests_per_hour: "100",
                pricing: [{
                  unit: "usdm",
                  quantity: "500000000",
                }],
              }
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Agent registered',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: registerAgentSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  txHash: "tx_hash",
                }
              }
            })
          }
        }
      }
    }
  })

  registry.registerPath({
    method: 'delete',
    path: '/registry/',
    description: 'Deregisters a agent from the specified registry.',
    summary: 'REQUIRES API KEY Authentication (+PAY)',
    tags: ['registry',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: unregisterAgentSchemaInput.openapi({
        example: { assetName: "asset_name", network: $Enums.Network.PREPROD, paymentContractAddress: "address" }
      })
    },
    responses: {
      200: {
        description: 'Payment source deleted',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: unregisterAgentSchemaOutput }).openapi({
              example: { status: "success", data: { txHash: "tx_hash" } }
            })
          }
        }
      }
    }
  })

  /********************* PAYMENT SOURCE *****************************/
  registry.registerPath({
    method: 'get',
    path: '/payment-source/',
    description: 'Gets the payment sources including the status.',
    summary: 'REQUIRES API KEY Authentication (+ADMIN)',
    tags: ['payment-source',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: paymentSourceSchemaInput.openapi({
        example: {
          take: 10,
          cursorId: "cursor_id"
        }
      })
    },
    responses: {
      200: {
        description: 'Payment source status',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: paymentSourceSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  paymentSources: [{
                    id: "unique_cuid_v2_auto_generated",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    network: $Enums.Network.PREPROD,
                    paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                    paymentContractAddress: "address_of_the_smart_contract",
                    rpcProviderApiKey: "rpc_provider_api_key",
                    isSyncing: false,
                    lastPageChecked: 1,
                    lastCheckedAt: new Date(),
                    lastIdentifierChecked: null,
                    AdminWallets: [{ walletAddress: "wallet_address", order: 0 }, { walletAddress: "wallet_address", order: 1 }, { walletAddress: "wallet_address", order: 2 }],
                    CollectionWallet: { id: "unique_cuid_v2_auto_generated", walletAddress: "wallet_address", note: "note" },
                    PurchasingWallets: [{ id: "unique_cuid_v2_auto_generated", walletVkey: "wallet_vkey", walletAddress: "wallet_address", note: "note" }],
                    SellingWallets: [{ id: "unique_cuid_v2_auto_generated", walletVkey: "wallet_vkey", walletAddress: "wallet_address", note: "note" }],
                    FeeReceiverNetworkWallet: { walletAddress: "wallet_address" },
                    feePermille: 50
                  }]
                }
              }
            })
          }
        }
      }
    }
  })

  registry.registerPath({
    method: 'post',
    path: '/payment-source/',
    description: 'Creates a payment source.',
    summary: 'REQUIRES API KEY Authentication (+ADMIN)',
    tags: ['payment-source',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: paymentSourceCreateSchemaInput.openapi({
              example: {
                network: $Enums.Network.PREPROD,
                paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                rpcProviderApiKey: "rpc_provider_api_key",
                AdminWallets: [{ walletAddress: "wallet_address_1" }, { walletAddress: "wallet_address_2" }, { walletAddress: "wallet_address_3" }],
                FeeReceiverNetworkWallet: { walletAddress: "wallet_address" },
                feePermille: 50,
                CollectionWallet: { walletAddress: "wallet_address", note: "note" },
                PurchasingWallets: [{ walletMnemonic: "wallet mnemonic", note: "note" }],
                SellingWallets: [{ walletMnemonic: "wallet mnemonic", note: "note" }]
              }
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Payment source created',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: paymentSourceCreateSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  id: "unique_cuid_v2_auto_generated",
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  network: $Enums.Network.PREPROD,
                  paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                  paymentContractAddress: "address_of_the_smart_contract",
                  rpcProviderApiKey: "rpc_provider_api_key",
                  isSyncing: false,
                  lastPageChecked: 1,
                  lastCheckedAt: new Date(),
                  lastIdentifierChecked: null,
                }
              }
            })
          }
        }
      }
    }
  })

  registry.registerPath({
    method: 'patch',
    path: '/payment-source/',
    description: 'Creates a payment source.',
    summary: 'REQUIRES API KEY Authentication (+ADMIN)',
    tags: ['payment-source',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      body: {
        description: '',
        content: {
          'application/json': {
            schema: paymentSourceUpdateSchemaInput.openapi({
              example: {
                id: "unique_cuid_v2",
                lastIdentifierChecked: "optional_identifier",
                lastPageChecked: 1,
                rpcProviderApiKey: "rpc_provider_api_key",
                CollectionWallet: { walletAddress: "wallet_address", note: "note" },
                AddPurchasingWallets: [{ walletMnemonic: "wallet_mnemonic", note: "note" }],
                AddSellingWallets: [{ walletMnemonic: "wallet_mnemonic", note: "note" }],
                RemovePurchasingWallets: [{ id: "unique_cuid_v2" }],
                RemoveSellingWallets: [{ id: "unique_cuid_v2" }]
              }
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Payment source created',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: paymentSourceUpdateSchemaOutput }).openapi({
              example: {
                status: "success",
                data: {
                  paymentContractAddress: "address_of_the_smart_contract",
                  id: "unique_cuid_v2_auto_generated",
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  network: $Enums.Network.PREPROD,
                  paymentType: $Enums.PaymentType.WEB3_CARDANO_V1,
                  rpcProviderApiKey: "rpc_provider_api_key",
                  lastPageChecked: 1,
                  lastCheckedAt: new Date(),
                  lastIdentifierChecked: null,
                  isSyncing: false,
                }
              }
            })
          }
        }
      }
    }
  })

  registry.registerPath({
    method: 'delete',
    path: '/payment-source/',
    description: 'Deletes a payment source. WARNING will also delete all associated wallets and transactions.',
    summary: 'REQUIRES API KEY Authentication (+ADMIN)',
    tags: ['payment-source',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: paymentSourceDeleteSchemaInput.openapi({
        example: { id: "unique_cuid_v2_auto_generated" }
      })
    },
    responses: {
      200: {
        description: 'Payment source deleted',
        content: {
          'application/json': {
            schema: z.object({ status: z.string(), data: paymentSourceDeleteSchemaOutput }).openapi({
              example: { status: "success", data: { id: "unique_cuid_v2_auto_generated" } }
            })
          }
        }
      }
    }
  })
  /********************* UTXOS *****************************/
  registry.registerPath({
    method: 'get',
    path: '/utxos/',
    description: 'Gets UTXOs (internal)',
    summary: 'REQUIRES API KEY Authentication (+READ)',
    tags: ['utxos',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: getUTXOSchemaInput.openapi({
        example: {
          network: $Enums.Network.PREPROD,
          address: "addr1qx2ej34k567890",
          count: 10,
          page: 1,
          order: "desc",
        }
      })
    },
    responses: {
      200: {
        description: 'UTXOs',
        content: {
          'application/json': {
            schema: getUTXOSchemaOutput.openapi({
              example: {
                utxos: [{ txHash: "tx_hash", address: "addr1qx2ej34k567890", amount: [{ unit: "lovelace", quantity: 1000000 }], output_index: 1, block: "1" }]
              }
            }),
          },
        },
      },
    },
  });
  /********************* RPC API KEYS *****************************/
  registry.registerPath({
    method: 'get',
    path: '/rpc-api-keys/',
    description: 'Gets rpc api keys, currently only blockfrost is supported (internal)',
    summary: 'REQUIRES API KEY Authentication (+ADMIN)',
    tags: ['rpc-api-keys',],
    security: [{ [apiKeyAuth.name]: [] }],
    request: {
      query: getRpcProviderKeysSchemaInput.openapi({
        example: {
          cursorId: "unique_cuid_v2",
          limit: 50,
        }
      })
    },
    responses: {
      200: {
        description: 'Blockfrost keys',
        content: {
          'application/json': {
            schema: getRpcProviderKeysSchemaOutput.openapi({
              example: {
                rpcProviderKeys: [{ network: $Enums.Network.PREPROD, id: "unique_cuid_v2", rpcProviderApiKey: "blockfrost_api_key", createdAt: new Date(), updatedAt: new Date() }]
              }
            }),
          },
        },
      },
    },
  });

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Template API',
      description: 'This is the default API from a template',
    },

    servers: [{ url: './../api/v1/' }],
  });
}

