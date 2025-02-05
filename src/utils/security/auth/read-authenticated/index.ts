import { defaultEndpointsFactory } from "express-zod-api";
import { authMiddleware } from "@/utils/middleware/auth-middleware";

export const readAuthenticatedEndpointFactory = defaultEndpointsFactory.addMiddleware(authMiddleware("READ"))