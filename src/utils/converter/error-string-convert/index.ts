export function convertErrorString(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && error !== undefined) {
    if (typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch {
        return '[object Object]';
      }
    }
    if (typeof error === 'string') {
      return error;
    }
  }
  return 'Unknown error';
}
