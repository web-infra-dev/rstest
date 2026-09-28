import { getShardedFiles } from '../../src/utils/shard';

describe('getShardedFiles', () => {
  it.each([
    { total: 10, count: 3, sizes: [4, 3, 3] },
    { total: 6, count: 4, sizes: [2, 2, 1, 1] },
    { total: 6, count: 3, sizes: [2, 2, 2] },
    { total: 2, count: 4, sizes: [1, 1, 0, 0] },
    { total: 0, count: 3, sizes: [0, 0, 0] },
  ])(
    'distributes $total files across $count shards',
    ({ total, count, sizes }) => {
      const files = Array.from({ length: total }, (_, index) => ({
        testPath: `${String(index).padStart(2, '0')}.test.ts`,
      }));
      const shards = sizes.map((_, index) =>
        getShardedFiles([...files].reverse(), { index: index + 1, count }, '/'),
      );

      expect(shards.map((shard) => shard.length)).toEqual(sizes);
      expect(shards.flat()).toHaveLength(total);
      expect(shards.flat()).toEqual(expect.arrayContaining(files));
    },
  );

  it('preserves the input when there is only one shard', () => {
    const files = [{ testPath: 'b.test.ts' }, { testPath: 'a.test.ts' }];

    expect(getShardedFiles(files, { index: 1, count: 1 }, '/')).toBe(files);
  });

  it.each([
    {
      root: '/repo',
      paths: ['/repo/a.test.ts', '/repo/b.test.ts', '/repo/c.test.ts'],
    },
    {
      root: '/other/repo',
      paths: [
        '/other/repo/a.test.ts',
        '/other/repo/b.test.ts',
        '/other/repo/c.test.ts',
      ],
    },
    {
      root: 'C:\\repo',
      paths: [
        'C:\\repo\\a.test.ts',
        'C:\\repo\\b.test.ts',
        'C:\\repo\\c.test.ts',
      ],
    },
  ])('matches Jest hash ordering under $root', ({ root, paths }) => {
    const files = paths.map((testPath) => ({ testPath }));

    expect(getShardedFiles(files, { index: 1, count: 2 }, root)).toEqual([
      files[0],
      files[2],
    ]);
    expect(
      getShardedFiles([...files].reverse(), { index: 2, count: 2 }, root),
    ).toEqual([files[1]]);
  });
});
