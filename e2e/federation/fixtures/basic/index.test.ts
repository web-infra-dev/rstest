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

it('should preserve emitted binary assets in the virtual file system', () => {
  const fs = require('node:fs');
  const emittedImagePath = resolve(__dirname, 'dist/.rstest-temp', imagePath);
  expect(fs.existsSync(emittedImagePath)).toBe(true);

  fs.readFileSync(emittedImagePath, 'utf8');
  const mutatedContent = fs.readFileSync(emittedImagePath);
  mutatedContent[0] = 0;
  const content = fs.readFileSync(emittedImagePath);
  const sourceContent = fs.readFileSync(
    resolve(
      __dirname,
      '../../../../examples/federation/component-app/src/MF.jpeg',
    ),
  );
  expect(content.equals(sourceContent)).toBe(true);
});
