/*import { logger } from '@/utils/logger';


export interface DefaultRetryPolicy {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    timeout?: number;
}

export interface ErrorResolution {
    remainingAttempts: number;
    shouldRetry: boolean;
    error?: Error;
}

export type ErrorResolverBase = (error: unknown, attempt: number) => ErrorResolution;
export type ErrorResolver<T> = (configuration: T) => ErrorResolverBase;

export interface RetryOptions<T> {
    operation: () => Promise<T>;
    errorResolvers?: ErrorResolver<T>[];
    onRetry?: (attempt: number, error: Error, nextRetryMs: number) => void;
    context?: Record<string, unknown>;
}

export interface RetryResult<T> {
    success: boolean;
    result?: T;
    error?: Error;
    attempts: number;
    totalDurationMs: number;
}

const DEFAULT_RETRY_POLICY: DefaultRetryPolicy = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    timeout: 60000,
};

export const timeoutErrorResolver: ErrorResolver<T> = (error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
        errorMessage.includes('timeout') ||
        errorMessage.includes('Timeout')
    ) {
        return {
            shouldRetry: true,
            error: new RetryableError(errorMessage, 'TIMEOUT', error instanceof Error ? error : undefined)
        };
    }
    return null;
};


export async function retry<T>({
    operation,
    errorResolvers = [],
    onRetry,
    context = {}
}: RetryOptions<T>): Promise<RetryResult<T>> {
    const startTime = Date.now();
    let attempts = 0;

    // Combine default resolvers with custom ones
    const resolvers = [
        timeoutErrorResolver,
        ...errorResolvers,
    ];

    while (attempts < finalPolicy.maxAttempts) {
        attempts++;
        try {
            const result = await operation();
            return {
                success: true,
                result,
                attempts,
                totalDurationMs: Date.now() - startTime
            };
        } catch (error) {
            // Try each resolver in sequence until one returns a resolution

        }
    }

    throw new Error('Unexpected retry loop exit');
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
*/