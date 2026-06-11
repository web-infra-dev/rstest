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
  'custom-node-environment.teardown.txt',
);

describe('custom builtin node environment', () => {
  it('should load a local custom environment that extends builtin node', async () => {
    fs.rmSync(teardownFile, { force: true });

    const { expectExecSuccess } = await runCli(
      'test/customNodeEnvironment',
      undefined,
      {
        args: ['--config', 'rstest.customNodeEnvironment.config.mts'],
      },
    );

    await expectExecSuccess();

    expect(fs.readFileSync(teardownFile, 'utf8')).toBe('node-marker');

    fs.rmSync(teardownFile, { force: true });
  });
});
