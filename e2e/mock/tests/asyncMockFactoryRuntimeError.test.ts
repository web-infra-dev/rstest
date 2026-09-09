import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('async mock factories', () => {
  it('reports an error instead of silently half-supporting them', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, '../fixtures/asyncMockFactoryRuntimeError'),
        },
      },
    });

    await expectExecFailed();

    expectStderrLog('[Rstest] An async mock factory is not supported.');
    expectStderrLog('Use a sync factory; to keep part of the original module');
    expectStderrLog("with { rstest: 'importActual' }");
  });
});
