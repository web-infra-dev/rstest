import type { RuntimeConfig } from '../../types';

export const runSetupFiles = async <T>(
  entries: T[],
  load: (entry: T) => unknown,
  order: RuntimeConfig['sequence']['setupFiles'],
): Promise<void> => {
  if (order !== 'parallel') {
    for (const entry of entries) {
      await load(entry);
    }
    return;
  }

  // A rejected setup must not start teardown while sibling setups still run.
  const results = await Promise.allSettled(
    entries.map(async (entry) => load(entry)),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
};
