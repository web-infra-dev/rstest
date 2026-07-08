// Import-time side effect that must never run when this package is mocked.
throw new Error('boom-esm was evaluated');
export const real = true;
