import { defaultEndpointsFactory } from "express-zod-api";
import { authMiddleware } from "@/utils/middleware/auth-middleware";
import { Permission } from "@prisma/client";

export const adminAuthenticatedEndpointFactory = defaultEndpointsFactory.addMiddleware(authMiddleware(Permission.Admin))
