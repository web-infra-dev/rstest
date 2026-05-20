import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runCli } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const teardownFile = join(
  __dirname,
  'fixtures',
  'test',
  'package-environment.teardown.txt',
);

describe('package environment fallback', () => {
  it('should resolve rstest-environment-* packages from testEnvironment.name', async () => {
    fs.rmSync(teardownFile, { force: true });

    const { expectExecSuccess } = await runCli(
      'test/packageEnvironment',
      undefined,
      {
        args: ['--config', 'rstest.packageEnvironment.config.mts'],
      },
    );

    await expectExecSuccess();

    expect(fs.readFileSync(teardownFile, 'utf8')).toBe('package-marker');

    fs.rmSync(teardownFile, { force: true });
  });
});
