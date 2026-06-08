import { afterAll, expect, it, rs } from '@rstest/core';

// Regression for #1327 (node builtins) / #1328 (ESM-only npm packages): a dynamic
// `import()` of a mocked externalized specifier must resolve to the mock, not the
// real module (static `import` was never affected). rspack gives the dynamic
// import a different external module id than the hoisted `rs.mock`, so the mock
// is routed by request via `rstest_dynamic_require`. These assert the mock RESULT
// at runtime — not the emitted codegen.

// #1327: node built-in module.
rs.mock('node:child_process', () => ({
  execSync: () => 'MOCKED',
}));

// #1328: ESM-only npm package (`strip-ansi@7` is `"type": "module"` with no CJS
// entry — the same category as the issue's `p-limit@5`).
rs.mock('strip-ansi', () => ({
  default: () => 'MOCKED_STRIP',
}));

afterAll(() => {
  rs.doUnmock('node:child_process');
  rs.doUnmock('strip-ansi');
});

it('dynamic import() of a mocked node builtin resolves to the mock (#1327)', async () => {
  const cp = await import('node:child_process');
  const execSync = cp.execSync as unknown as () => string;
  expect(execSync()).toBe('MOCKED');
});

it('dynamic import() of a mocked ESM-only npm package resolves to the mock (#1328)', async () => {
  const mod = (await import('strip-ansi')) as unknown as {
    default: () => string;
  };
  expect(mod.default()).toBe('MOCKED_STRIP');
});

it('dynamic import() of an unmocked external loads the real module', async () => {
  // `node:os` is external but never mocked: the shim must pass through to the
  // real module, proving interception is gated on "is external", not "is mocked".
  const os = await import('node:os');
  expect(os.platform()).toBe(process.platform);
});

it('rs.unmock after a dynamic import() restores the real external module', async () => {
  rs.doMock('node:zlib', () => ({ __tag: 'MOCKED_ZLIB' }));

  const mocked = (await import('node:zlib')) as unknown as { __tag?: string };
  expect(mocked.__tag).toBe('MOCKED_ZLIB');

  rs.doUnmock('node:zlib');

  const real = (await import('node:zlib')) as unknown as {
    __tag?: string;
    gzipSync?: unknown;
  };
  expect(real.__tag).toBeUndefined();
  expect(typeof real.gzipSync).toBe('function');
});
