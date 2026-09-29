import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixtureDir = join(__dirname, '../fixtures/mockCjsRequireInterop');

describe('rs.mock with require for a CJS module', () => {
  it('works without ESM test files in the build', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixtureDir } },
    });

    await expectExecSuccess();
  });

  it('works when an ESM test shares the build runtime', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--config', 'rstest.esm-neighbor.config.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixtureDir } },
    });

    await expectExecSuccess();
  });
});
