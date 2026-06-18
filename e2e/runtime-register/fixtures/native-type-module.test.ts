import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@rstest/core';

const probeNativeTypeScriptSupport = () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'rstest-ts-probe-'));

  try {
    writeFileSync(
      join(fixtureDir, 'probe.ts'),
      'module.exports = 1 as number;\n',
    );

    const result = spawnSync(
      process.execPath,
      ['--eval', "require('./probe.ts')"],
      {
        cwd: fixtureDir,
        encoding: 'utf-8',
      },
    );

    return result.status === 0;
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
};

const supportsNativeTypeScript = probeNativeTypeScriptSupport();

const createFixture = (extension: 'ts' | 'cts') => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'rstest-type-module-'));

  writeFileSync(join(fixtureDir, 'package.json'), '{"type":"module"}\n');
  writeFileSync(
    join(fixtureDir, `plugin.${extension}`),
    'module.exports = { value: 1 as number };\n',
  );
  writeFileSync(
    join(fixtureDir, 'main.mjs'),
    `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const plugin = require('./plugin.${extension}');
console.log(JSON.stringify(plugin));
`,
  );

  return fixtureDir;
};

test.skipIf(!supportsNativeTypeScript)(
  'keeps native node semantics for cjs-style .ts in type module scope',
  ({ onTestFinished }) => {
    const fixtureDir = createFixture('ts');
    onTestFinished(() => rmSync(fixtureDir, { recursive: true, force: true }));

    const result = spawnSync(process.execPath, ['main.mjs'], {
      cwd: fixtureDir,
      encoding: 'utf-8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('module is not defined in ES module scope');
  },
);

test.skipIf(!supportsNativeTypeScript)(
  'loads cjs-style TypeScript when the runtime file uses .cts',
  ({ onTestFinished }) => {
    const fixtureDir = createFixture('cts');
    onTestFinished(() => rmSync(fixtureDir, { recursive: true, force: true }));

    const result = spawnSync(process.execPath, ['main.mjs'], {
      cwd: fixtureDir,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"value":1}');
  },
);
