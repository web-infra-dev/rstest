import {
  resolveSnapshotPathDefault,
  SNAPSHOT_HEADER,
} from '../../src/utils/snapshotPath';

describe('resolveSnapshotPathDefault', () => {
  it('maps test/index.ts -> test/__snapshots__/index.ts.snap', () => {
    expect(resolveSnapshotPathDefault('/a/b/index.test.ts')).toBe(
      '/a/b/__snapshots__/index.test.ts.snap',
    );
  });

  it('honors a user-provided resolver and passes the .snap extension', () => {
    const seen: string[] = [];
    const custom = (testPath: string, snapExtension: string): string => {
      seen.push(snapExtension);
      return `/custom/${testPath}${snapExtension}`;
    };
    expect(resolveSnapshotPathDefault('/a/b.test.ts', custom)).toBe(
      '/custom//a/b.test.ts.snap',
    );
    expect(seen).toEqual(['.snap']);
  });

  it('exposes the shared snapshot header', () => {
    expect(SNAPSHOT_HEADER).toBe('// Rstest Snapshot');
  });
});
