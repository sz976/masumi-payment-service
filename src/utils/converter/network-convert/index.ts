import { Network } from "@prisma/client";

export function convertNetwork(network: Network) {
    switch (network) {
        case "MAINNET":
            return "mainnet";
        case "PREPROD":
            return "preprod";
        default:
            throw new Error("Invalid network");
    }
}
export function convertNetworkToId(network: Network) {
    switch (network) {
        case "MAINNET":
            return 1;
        case "PREPROD":
            return 0;
        default:
            throw new Error("Invalid network");
    }
}
