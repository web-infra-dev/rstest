/**
 * Awaits a pool run that is expected to reject and hands back the rejection so
 * the test can assert on the enriched message. A run that resolves — or rejects
 * with something that carries no message — fails here rather than further down
 * on an `undefined` message.
 */
export const expectRejection = async (
  promise: Promise<unknown>,
): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(
      `Expected the pool run to reject with an Error, got: ${String(error)}`,
    );
  }
  throw new Error('Expected the pool run to reject, but it resolved.');
};
