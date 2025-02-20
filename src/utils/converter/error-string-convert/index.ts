export function convertErrorString(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    if (error !== null && error !== undefined) {
        return String(error);
    }
    return 'Unknown error';
}
