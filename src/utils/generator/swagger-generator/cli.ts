import { generateOpenAPI } from ".";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export function writeDocumentation(docs: unknown) {
    // Get the directory name in an ES module
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Custom replacer function to handle BigInt
    const replacer = (key: string, value: unknown): string | number | boolean | null | unknown => {
        if (typeof value === 'bigint') {
            return value.toString();
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        return value;
    };

    fs.writeFileSync(`${__dirname}/openapi-docs.json`, JSON.stringify(docs, replacer, 4), {
        encoding: "utf-8",
    });
}

const docs = generateOpenAPI();
writeDocumentation(docs);