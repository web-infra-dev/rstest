import { expect, rs, test } from '@rstest/core';
import increment from 'react';
import { getBasename, joinPaths } from '../src/defaultImportCjs';

rs.mock('react', () => {
  return {
    default: (num: number) => num + 42,
  };
});

// Mock node:path with a factory that has no `default` property.
// The mock system should auto-create a default export so that
// `import path from 'node:path'` in the source module works correctly.
rs.mock('node:path', () => {
  return {
    basename: (filePath: string) => `mocked-${filePath.split('/').pop()}`,
    join: (...paths: string[]) => paths.join('/'),
  };
});

test('interop default export', async () => {
  // @ts-expect-error
  expect(increment(1)).toBe(43);
});

test('interop default export for factory without explicit default', () => {
  expect(getBasename('/foo/bar/baz.txt')).toBe('mocked-baz.txt');
  expect(joinPaths('a', 'b', 'c')).toBe('a/b/c');
});
