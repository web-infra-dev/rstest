/**
 * Awaits a pool run that is expected to reject and hands back the rejection so
 * the test can assert on the enriched message. A run that resolves fails here
 * rather than further down on an `undefined` message.
 */
export const expectRejection = async (
  promise: Promise<unknown>,
): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected the pool run to reject, but it resolved.');
};
