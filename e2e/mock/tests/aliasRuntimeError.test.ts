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

    expectStderrLog(
      'rs.mock() must be called as rstest.mock() or rs.mock() so Rstest can transform it',
    );
    expectStderrLog('Import aliases are not supported for module mock APIs');
  });
});
