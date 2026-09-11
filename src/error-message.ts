// Convert thrown values, including errors from another execution context, to text.
export const errorMessage = (error: unknown): string =>
  error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : String(error)
