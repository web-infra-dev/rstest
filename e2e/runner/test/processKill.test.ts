import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@rstest/core';
import { runRstestCli } from '../../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);
it('should catch `process.kill` error correctly', async () => {
  const { cli, expectExecFailed, expectLog, expectStderrLog } =
    await runRstestCli({
      command: 'rstest',
      args: ['run', 'processKill.test.ts', '--disableConsoleIntercept'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });
  await expectExecFailed();

  const logs = cli.stdout.split('\n').filter(Boolean);

  expectLog('Test Files 1 failed', logs);

  expectStderrLog('FAIL  processKill.test.ts > process.kill');
  expectStderrLog(/process.kill unexpectedly called/);
});
