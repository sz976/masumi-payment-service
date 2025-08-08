import { authMiddleware } from '@/utils/middleware/auth-middleware';
import { Permission } from '@prisma/client';
import endpointFactory from '@/utils/generator/endpoint-factory';

export const adminAuthenticatedEndpointFactory = endpointFactory.addMiddleware(
  authMiddleware(Permission.Admin),
);
