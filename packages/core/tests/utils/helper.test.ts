import { sep } from 'node:path';
import {
  getFileTaskId,
  getWorkerSerialization,
  needFlagExperimentalDetectModule,
  parsePosix,
  prettyTime,
  toNativePath,
} from '../../src/utils/helper';

it('getFileTaskId builds the file: task-id grammar', () => {
  // Locks the single source of truth so the worker/pool/runner consumers and
  // the tests/pool/fixtures/testWorker.mjs literal copy cannot drift.
  expect(getFileTaskId('/abs/foo.test.ts')).toBe('file:/abs/foo.test.ts');
});

it('toNativePath converts forward-slash paths to OS-native separators', () => {
  // The runtime `testPath` must use OS-native separators so it matches
  // `import.meta.filename` on Windows (#1465). `join(sep)` keeps this
  // assertion meaningful on both platforms: on Windows the result must use
  // backslashes, on POSIX it stays `/` (native == POSIX there).
  expect(toNativePath('packages/core/a.test.ts')).toBe(
    'packages/core/a.test.ts'.replaceAll('/', sep),
  );
  // Absolute paths are converted too.
  expect(toNativePath('/abs/foo.test.ts')).toBe(
    '/abs/foo.test.ts'.replaceAll('/', sep),
  );
  // The output must never keep `/` unless `/` is the native separator.
  expect(toNativePath('a/b/c').includes('/')).toBe(sep === '/');
});

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
  expect(prettyTime(299999)).toBe('5m');
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

// `--experimental-detect-module` is injected into every worker (see
// `getNodeExecArgv` in src/pool/index.ts) only on Node versions where it is
// meaningful: 20.10+ (opt-in) and 22.x < 7 (before it became default-on). It
// must NEVER be injected on Node 24+. Faking `process.versions.node` pins the
// version gate so this default-on worker path keeps coverage even though PR CI
// only runs Node 24 (the actual runtime behavior is covered by the post-merge
// full run on Node 20).
it('needFlagExperimentalDetectModule gates on the Node version', () => {
  // `process.versions.node` is read-only (writable: false) but configurable,
  // so override it via defineProperty and restore the original descriptor.
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    process.versions,
    'node',
  );
  const evaluate = (version: string) => {
    Object.defineProperty(process.versions, 'node', {
      value: version,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    return needFlagExperimentalDetectModule();
  };

  try {
    expect({
      '20.9.0': evaluate('20.9.0'),
      '20.10.0': evaluate('20.10.0'),
      '20.19.0': evaluate('20.19.0'),
      '22.6.0': evaluate('22.6.0'),
      '22.7.0': evaluate('22.7.0'),
      '22.12.0': evaluate('22.12.0'),
      '24.0.0': evaluate('24.0.0'),
    }).toEqual({
      '20.9.0': false, // before 20.10.0
      '20.10.0': true, // introduced
      '20.19.0': true, // engines floor (^20.19.0)
      '22.6.0': true, // 22.x before default-on
      '22.7.0': false, // default-on since 22.7.0
      '22.12.0': false,
      '24.0.0': false, // never injected on Node 24+
    });
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(process.versions, 'node', originalDescriptor);
    }
  }
});
