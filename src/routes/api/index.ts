import { DependsOnMethod, Routing } from 'express-zod-api';
import { healthEndpointGet } from '@/routes/api/health';
import {
  queryAPIKeyEndpointGet as queryCentralizedRegistrySourceGet,
  addAPIKeyEndpointPost as addCentralizedRegistrySourceEndpointPost,
  updateAPIKeyEndpointPatch,
  deleteAPIKeyEndpointDelete as deleteCentralizedRegistrySourceEndpointDelete,
} from './api-key';
import { createPurchaseInitPost, queryPurchaseRequestGet } from './purchases';
import { paymentInitPost, queryPaymentEntryGet } from './payments';
import {
  queryRegistryRequestGet,
  registerAgentPost,
  unregisterAgentDelete,
} from './registry';
import {
  paymentSourceExtendedEndpointDelete,
  paymentSourceExtendedEndpointGet,
  paymentSourceExtendedEndpointPatch,
  paymentSourceExtendedEndpointPost,
} from './payment-source-extended';
import { queryAPIKeyStatusEndpointGet } from './api-key-status';
import { postWalletEndpointPost, queryWalletEndpointGet } from './wallet';
import { queryRpcProviderKeysEndpointGet } from './rpc-api-keys';
import { queryUTXOEndpointGet } from './utxos';
import { paymentSourceEndpointGet } from './payment-source';
import { submitPaymentResultEndpointPost } from './payments/submit-result';
import { authorizePaymentRefundEndpointPost } from './payments/authorize-refund';
import { requestPurchaseRefundPost } from './purchases/request-refund';
import { cancelPurchaseRefundRequestPost } from './purchases/cancel-refund-request';
import { queryAgentFromWalletGet } from './registry/wallet';

export const apiRouter: Routing = {
  v1: {
    health: healthEndpointGet,
    purchase: new DependsOnMethod({
      get: queryPurchaseRequestGet,
      post: createPurchaseInitPost,
    }).nest({
      'request-refund': new DependsOnMethod({
        post: requestPurchaseRefundPost,
      }),
      'cancel-refund-request': new DependsOnMethod({
        post: cancelPurchaseRefundRequestPost,
      }),
    }),
    payment: new DependsOnMethod({
      get: queryPaymentEntryGet,
      post: paymentInitPost,
    }).nest({
      'authorize-refund': new DependsOnMethod({
        post: authorizePaymentRefundEndpointPost,
      }),
      'submit-result': new DependsOnMethod({
        post: submitPaymentResultEndpointPost,
      }),
    }),
    registry: new DependsOnMethod({
      get: queryRegistryRequestGet,
      post: registerAgentPost,
      delete: unregisterAgentDelete,
    }).nest({
      wallet: new DependsOnMethod({
        get: queryAgentFromWalletGet,
      }),
    }),
    'api-key-status': new DependsOnMethod({
      get: queryAPIKeyStatusEndpointGet,
    }),
    'api-key': new DependsOnMethod({
      get: queryCentralizedRegistrySourceGet,
      post: addCentralizedRegistrySourceEndpointPost,
      patch: updateAPIKeyEndpointPatch,
      delete: deleteCentralizedRegistrySourceEndpointDelete,
    }),
    wallet: new DependsOnMethod({
      get: queryWalletEndpointGet,
      post: postWalletEndpointPost,
    }),
    'payment-source-extended': new DependsOnMethod({
      get: paymentSourceExtendedEndpointGet,
      post: paymentSourceExtendedEndpointPost,
      patch: paymentSourceExtendedEndpointPatch,
      delete: paymentSourceExtendedEndpointDelete,
    }),
    'rpc-api-keys': new DependsOnMethod({
      get: queryRpcProviderKeysEndpointGet,
    }),
    utxos: new DependsOnMethod({
      get: queryUTXOEndpointGet,
    }),
    'payment-source': new DependsOnMethod({
      get: paymentSourceEndpointGet,
    }),
  },
};
