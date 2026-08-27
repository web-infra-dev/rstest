import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test EsModulesLinkingError', () => {
  for (const pool of ['forks', 'vmThreads'] as const) {
    it(`should not print EsModulesLinkingError under ${pool}`, async () => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--pool',
          pool,
          ...(pool === 'vmThreads' ? ['--pool.memoryLimit', '256MB'] : []),
        ],
        options: {
          nodeOptions: {
            cwd: join(__dirname, '../fixtures/esModulesLinkingError'),
          },
        },
      });

      await expectExecSuccess();

      const logs = cli.stdout.split('\n').filter(Boolean);

      expect(
        logs.find((log) => log.match(/ESModulesLinkingError: export 'value'/)),
      ).toBeUndefined();
    });
  }
});
