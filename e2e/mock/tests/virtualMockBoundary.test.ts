import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('virtual module mocks', () => {
  it('defines non-existent modules through an alias or manual mock', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, '../fixtures/virtualMockDefinitions'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('requires a factory when the original module does not exist', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, '../fixtures/virtualMockWithoutFactory'),
        },
      },
    });

    await expectExecFailed();

    expectStderrLog(
      "rs.mock('virtual-without-factory', { mock: true }) failed: cannot load original module",
    );
  });
});
