import { Middleware } from "express-zod-api";
import createHttpError from "http-errors";
import { prisma } from '@/utils/db';
import { z } from "zod";
import { Permission, ApiKeyStatus, Network } from "@prisma/client";

export const authMiddleware = (minPermission: Permission) => new Middleware({
    security: {
        // this information is optional and used for generating documentation
        type: "header", name: "api-key"
    },
    input: z.object({
    }),
    handler: async ({ request, logger }) => {
        try {

            const sendKey = request.headers.token
            if (!sendKey) {
                throw createHttpError(401, "Unauthorized, no authentication token provided");
            }

            const apiKey = await prisma.apiKey.findUnique({
                where: {
                    token: sendKey as string,
                }
            })

            if (!apiKey) {
                throw createHttpError(401, "Unauthorized, invalid authentication token provided");
            }

            if (apiKey.status !== ApiKeyStatus.Active) {
                throw createHttpError(401, "Unauthorized, API key is revoked");
            }

            if (minPermission == Permission.Admin && apiKey.permission != Permission.Admin) {
                throw createHttpError(401, "Unauthorized, admin access required");
            }

            if (minPermission == Permission.ReadAndPay && (apiKey.permission != Permission.ReadAndPay && apiKey.permission != Permission.Admin)) {
                throw createHttpError(401, "Unauthorized, payment access required");
            }

            if (minPermission == Permission.Read && apiKey.permission != Permission.Read && apiKey.permission != Permission.Admin && apiKey.permission != Permission.ReadAndPay) {
                throw createHttpError(401, "Unauthorized, read access required");
            }

            return { id: apiKey.id, permission: apiKey.permission, networkLimit: apiKey.networkLimit, usageLimited: apiKey.usageLimited }; // provides endpoints with options.user
        } catch (error) {
            //await a random amount to throttle invalid requests
            logger.info("Throttling invalid requests", { error });
            await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));
            throw error;
        }
    },
});

export async function checkIsAllowedNetworkOrThrowUnauthorized(networkLimit: Network[], network: Network, permission: Permission) {
    if (permission == Permission.Admin) {
        return;
    }

    if (!networkLimit.includes(network)) {
        //await a random amount to throttle invalid requests
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));
        throw createHttpError(401, "Unauthorized, network not allowed");
    }
}