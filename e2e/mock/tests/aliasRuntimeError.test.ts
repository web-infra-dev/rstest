import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('mock API aliases', () => {
  it('reports an error when module mock APIs are called through an alias', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, '../fixtures/aliasRuntimeError'),
        },
      },
    });

    await expectExecFailed();

    expectStderrLog('mock() was not transformed by Rstest');
    expectStderrLog(
      'Module mock APIs must be called directly as rstest.mock() or rs.mock() in files processed by Rstest',
    );
    expectStderrLog('calling file is not bundled by Rstest');
    expectStderrLog('called through an import alias');
  });
});
