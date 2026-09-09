import { basename, dirname, join } from 'pathe';

/**
 * Header written at the top of every `.snap` file.
 *
 * Shared by the node worker snapshot environment and the browser client so
 * snapshot files stay byte-identical regardless of which executor wrote them.
 */
export const SNAPSHOT_HEADER = '// Rstest Snapshot';

const SNAPSHOT_EXTENSION = '.snap';

/**
 * Resolve the on-disk snapshot path for a test file: honor a user-provided
 * `resolveSnapshotPath`, otherwise map `dir/index.ts` ->
 * `dir/__snapshots__/index.ts.snap`.
 *
 * Shared by the node pool RPC and the browser host so both executors resolve
 * snapshot paths identically.
 */
export const resolveSnapshotPathDefault = (
  testPath: string,
  resolveSnapshotPath?: (testPath: string, snapExtension: string) => string,
): string => {
  const resolver =
    resolveSnapshotPath ||
    (() =>
      join(
        dirname(testPath),
        '__snapshots__',
        `${basename(testPath)}${SNAPSHOT_EXTENSION}`,
      ));
  return resolver(testPath, SNAPSHOT_EXTENSION);
};
