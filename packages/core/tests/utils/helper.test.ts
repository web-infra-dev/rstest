import { sep } from 'node:path';
import { parsePosix } from '../../src/utils/helper';

it('parsePosix correctly', () => {
  const splitPaths = ['packages', 'core', 'tests', 'index.test.ts'];

  expect(parsePosix(splitPaths.join(sep))).toEqual({
    dir: 'packages/core/tests',
    base: 'index.test.ts',
  });
});
