import { afterAll, expect, it, rs } from '@rstest/core';

// Regression for #1454: non-literal dynamic `import(expr)` calls go through
// the worker's `__rstest_dynamic_import__` hook rather than rspack's static
// `rstest_dynamic_require` rewrite, so the hook must consult the active mock
// registry before falling back to native module loading.

rs.mock('node:child_process', () => ({
  execSync: () => 'MOCKED_NON_LITERAL',
}));

rs.mock('strip-ansi', () => ({
  default: () => 'MOCKED_STRIP_NON_LITERAL',
}));

afterAll(() => {
  rs.doUnmock('node:child_process');
  rs.doUnmock('strip-ansi');
});

it('non-literal dynamic import(specifier) resolves mocked node builtin (#1454)', async () => {
  const specifier: string = 'node:child_process';
  const cp = await import(specifier);
  const execSync = cp.execSync as unknown as () => string;
  expect(execSync()).toBe('MOCKED_NON_LITERAL');
});

it('non-literal dynamic import(specifier) resolves mocked ESM package (#1454)', async () => {
  const specifier: string = 'strip-ansi';
  const mod = (await import(specifier)) as unknown as {
    default: () => string;
  };
  expect(mod.default()).toBe('MOCKED_STRIP_NON_LITERAL');
});

it('non-literal dynamic import(specifier) falls through for unmocked modules', async () => {
  const specifier: string = 'node:os';
  const os = await import(specifier);
  expect(os.platform()).toBe(process.platform);
});

it('rs.doUnmock restores real module for non-literal dynamic import(specifier)', async () => {
  const specifier: string = 'node:zlib';
  rs.doMock('node:zlib', () => ({ __tag: 'MOCKED_ZLIB_NON_LITERAL' }));

  const mocked = (await import(specifier)) as unknown as { __tag?: string };
  expect(mocked.__tag).toBe('MOCKED_ZLIB_NON_LITERAL');

  rs.doUnmock('node:zlib');

  const real = (await import(specifier)) as unknown as {
    __tag?: string;
    gzipSync?: unknown;
  };
  expect(real.__tag).toBeUndefined();
  expect(typeof real.gzipSync).toBe('function');
});
