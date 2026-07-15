import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@rstest/core';

const probeNativeTypeScriptSupport = async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'rstest-ts-probe-'));

  try {
    writeFileSync(
      join(fixtureDir, 'probe.ts'),
      'export const value = 1 as number;\n',
    );

    await import(pathToFileURL(join(fixtureDir, 'probe.ts')).href);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
};

const supportsNativeTypeScript = async () => {
  if (process.env.RSTEST_OUTPUT_MODULE === 'false') {
    return false;
  }

  return probeNativeTypeScriptSupport();
};

const createFixture = (extension: 'ts' | 'cts') => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'rstest-type-module-'));

  writeFileSync(join(fixtureDir, 'package.json'), '{"type":"module"}\n');
  writeFileSync(
    join(fixtureDir, `plugin.${extension}`),
    'module.exports = { value: 1 as number };\n',
  );

  return fixtureDir;
};

// Previously this asserted the native failure (`module is not defined`) for a
// cjs-style `.ts` in a `type: module` scope. `runtimeTsTransform` (default on,
// Node >= 22.22.3 / >= 24.11.1) now transforms exactly that mismatch, so the
// load succeeds. The scope here is a tmpdir outside the project root, which
// `e2e/runtimeTsTransform/` does not cover. See `e2e/runtimeTsTransform/` for
// the feature's own coverage, including the opt-out repro.
test('loads cjs-style .ts in a type module scope via runtimeTsTransform', async ({
  onTestFinished,
}) => {
  if (!(await supportsNativeTypeScript())) {
    return;
  }

  const fixtureDir = createFixture('ts');
  onTestFinished(() => rmSync(fixtureDir, { recursive: true, force: true }));

  const require = createRequire(
    pathToFileURL(join(fixtureDir, 'loader.mjs')).href,
  );

  expect(require('./plugin.ts')).toEqual({ value: 1 });
});

test('loads cjs-style TypeScript when the runtime file uses .cts', async ({
  onTestFinished,
}) => {
  if (!(await supportsNativeTypeScript())) {
    return;
  }

  const fixtureDir = createFixture('cts');
  onTestFinished(() => rmSync(fixtureDir, { recursive: true, force: true }));

  const require = createRequire(
    pathToFileURL(join(fixtureDir, 'loader.mjs')).href,
  );

  expect(require('./plugin.cts')).toEqual({ value: 1 });
});
