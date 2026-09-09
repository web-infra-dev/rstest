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

test('keeps native node semantics for cjs-style .ts in type module scope', async ({
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

  try {
    expect(require('./plugin.ts')).toEqual({});
  } catch (error) {
    if (!(error instanceof ReferenceError)) {
      throw error;
    }

    expect(error.message).toContain('module is not defined');
  }
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
