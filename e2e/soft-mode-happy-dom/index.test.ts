import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('experiments.softMode — happy-dom', () => {
  it('resets DOM/storage/prototype state between files (happy-dom env)', async ({
    onTestFinished,
  }) => {
    // Mirrors the jsdom soft-mode fixture for happy-dom. Verifies that
    // `softResetEnv` and the prototype-snapshot path handle the
    // `happy-dom` env-name branch the same way they handle `jsdom`.
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, './fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });
});
