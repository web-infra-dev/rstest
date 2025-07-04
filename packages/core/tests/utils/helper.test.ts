import { sep } from 'node:path';
import { parsePosix, prettyTime } from '../../src/utils/helper';

it('parsePosix correctly', () => {
  const splitPaths = ['packages', 'core', 'tests', 'index.test.ts'];

  expect(parsePosix(splitPaths.join(sep))).toEqual({
    dir: 'packages/core/tests',
    base: 'index.test.ts',
  });
});

it('should prettyTime correctly', () => {
  expect(prettyTime(100)).toBe('100ms');
  expect(prettyTime(1000)).toBe('1s');
  expect(prettyTime(1500)).toBe('1.50s');
  expect(prettyTime(2000)).toBe('2s');
  expect(prettyTime(3000)).toBe('3s');
  expect(prettyTime(60000)).toBe('1m');
  expect(prettyTime(110000)).toBe('1m 50s');
  expect(prettyTime(111100)).toBe('1m 51s');
  expect(prettyTime(111900)).toBe('1m 52s');
});
