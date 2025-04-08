import { defaultEndpointsFactory } from 'express-zod-api';
import { authMiddleware } from '@/utils/middleware/auth-middleware';
import { Permission } from '@prisma/client';

export const readAuthenticatedEndpointFactory =
  defaultEndpointsFactory.addMiddleware(authMiddleware(Permission.Read));
