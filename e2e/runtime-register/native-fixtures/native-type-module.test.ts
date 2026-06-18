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

const supportsNativeTypeScript = await probeNativeTypeScriptSupport();

const createFixture = (extension: 'ts' | 'cts') => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'rstest-type-module-'));

  writeFileSync(join(fixtureDir, 'package.json'), '{"type":"module"}\n');
  writeFileSync(
    join(fixtureDir, `plugin.${extension}`),
    'module.exports = { value: 1 as number };\n',
  );

  return fixtureDir;
};

test.skipIf(!supportsNativeTypeScript)(
  'keeps native node semantics for cjs-style .ts in type module scope',
  ({ onTestFinished }) => {
    const fixtureDir = createFixture('ts');
    onTestFinished(() => rmSync(fixtureDir, { recursive: true, force: true }));

    const require = createRequire(
      pathToFileURL(join(fixtureDir, 'loader.mjs')).href,
    );

    expect(() => require('./plugin.ts')).toThrow(
      /module is not defined in ES module scope/,
    );
  },
);

test.skipIf(!supportsNativeTypeScript)(
  'loads cjs-style TypeScript when the runtime file uses .cts',
  ({ onTestFinished }) => {
    const fixtureDir = createFixture('cts');
    onTestFinished(() => rmSync(fixtureDir, { recursive: true, force: true }));

    const require = createRequire(
      pathToFileURL(join(fixtureDir, 'loader.mjs')).href,
    );

    expect(require('./plugin.cts')).toEqual({ value: 1 });
  },
);
