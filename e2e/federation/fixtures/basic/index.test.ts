import { resolve } from 'node:path';
import { expect, it } from '@rstest/core';
import imagePath from '../../../../examples/federation/component-app/src/MF.jpeg';

it('should expose the federation flag and dynamic import fallback', async () => {
  expect((globalThis as any).__rstest_federation__).toBe(true);

  const dynamicImport = (globalThis as any).__rstest_dynamic_import__;
  expect(typeof dynamicImport).toBe('function');

  // The fallback must load modules via native dynamic import, the way
  // vm-evaluated Module Federation runtime chunks rely on it.
  const pathModule = await dynamicImport('node:path');
  expect(typeof pathModule.join).toBe('function');
});

it('should load absolute file paths through the dynamic import fallback', async () => {
  const dynamicImport = (globalThis as any).__rstest_dynamic_import__;

  // Federated async-node chunks call the fallback with raw absolute paths
  // (`C:\...` on Windows), which must be normalized to `file://` URLs before
  // they reach native `import()`.
  const { join } = await import('node:path');
  const mod = await dynamicImport(join(__dirname, 'absolute-target.mjs'));
  expect(mod.answer).toBe(42);
});

it('should set the federation flag during global setup', () => {
  expect(process.env.RSTEST_E2E_FEDERATION_IN_SETUP).toBe('true');
});

declare const __webpack_require__: any;

it('should load async chunks through the require chunk handler from memory', async () => {
  // Federation forces `output.chunkLoading: 'require'`; a dynamic import of a
  // local module produces a real js async chunk that only the generated
  // `f.require` handler can install (`f.readFileVm` is not generated, and the
  // federation `remotes`/`consumes` handlers ignore plain js chunks). Wrapping
  // `__webpack_require__.e` proves the import went through the chunk-ensure
  // machinery instead of being inlined, so a silent fallback to fs-based
  // loading fails this test on every platform.
  expect(__webpack_require__.f.readFileVm).toBeUndefined();
  expect(typeof __webpack_require__.f.require).toBe('function');

  const ensuredChunks: unknown[] = [];
  const originalEnsure = __webpack_require__.e;
  __webpack_require__.e = function (chunkId: unknown) {
    ensuredChunks.push(chunkId);
    return originalEnsure.call(this, chunkId);
  };
  try {
    const mod = await import('./lazy-target');
    expect(mod.answer).toBe(42);
  } finally {
    __webpack_require__.e = originalEnsure;
  }
  expect(ensuredChunks.length).toBeGreaterThan(0);
});

it('should preserve emitted binary assets on disk with writeToDisk', () => {
  const fs = require('node:fs');
  const emittedImagePath = resolve(__dirname, 'dist/.rstest-temp', imagePath);
  expect(fs.existsSync(emittedImagePath)).toBe(true);

  const content = fs.readFileSync(emittedImagePath);
  const sourceContent = fs.readFileSync(
    resolve(
      __dirname,
      '../../../../examples/federation/component-app/src/MF.jpeg',
    ),
  );
  expect(content.equals(sourceContent)).toBe(true);
});
