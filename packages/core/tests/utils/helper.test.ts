import { sep } from 'node:path';
import {
  getWorkerSerialization,
  parsePosix,
  prettyTime,
} from '../../src/utils/helper';

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

it('should use advanced serialization outside Bun', () => {
  const originalBunVersion = process.versions.bun;

  try {
    Reflect.deleteProperty(process.versions, 'bun');
    expect(getWorkerSerialization()).toBe('advanced');
  } finally {
    if (originalBunVersion !== undefined) {
      process.versions.bun = originalBunVersion;
    }
  }
});

it('should use json serialization in Bun', () => {
  const originalBunVersion = process.versions.bun;

  try {
    process.versions.bun = originalBunVersion ?? '1.0.0';
    expect(getWorkerSerialization()).toBe('json');
  } finally {
    if (originalBunVersion === undefined) {
      Reflect.deleteProperty(process.versions, 'bun');
    } else {
      process.versions.bun = originalBunVersion;
    }
  }
});
