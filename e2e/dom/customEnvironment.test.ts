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
  'custom-environment.teardown.txt',
);

describe('custom environment', () => {
  it('should load a local custom environment and extend builtin environments', async () => {
    fs.rmSync(teardownFile, { force: true });

    const { expectExecSuccess } = await runCli(
      'test/customEnvironment',
      undefined,
      {
        args: ['--config', 'rstest.customEnvironment.config.mts'],
      },
    );

    await expectExecSuccess();

    expect(fs.readFileSync(teardownFile, 'utf8')).toBe('custom-marker');

    fs.rmSync(teardownFile, { force: true });
  });
});
