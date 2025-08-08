import { authMiddleware } from '@/utils/middleware/auth-middleware';
import { Permission } from '@prisma/client';
import endpointFactory from '@/utils/generator/endpoint-factory';

export const payAuthenticatedEndpointFactory = endpointFactory.addMiddleware(
  authMiddleware(Permission.ReadAndPay),
);
