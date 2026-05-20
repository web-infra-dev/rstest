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
  'named-environment.teardown.txt',
);

describe('named export environment', () => {
  it('should load a local custom environment from a named export', async () => {
    fs.rmSync(teardownFile, { force: true });

    const { expectExecSuccess } = await runCli(
      'test/namedEnvironment',
      undefined,
      {
        args: ['--config', 'rstest.namedEnvironment.config.mts'],
      },
    );

    await expectExecSuccess();

    expect(fs.readFileSync(teardownFile, 'utf8')).toBe('named-marker');

    fs.rmSync(teardownFile, { force: true });
  });
});