import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('vue sfc', () => {
  it('should run vue SFC test correctly', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should run vue SFC test correctly in browser mode', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index', '--config=rstest.browser.config.mts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });
});
