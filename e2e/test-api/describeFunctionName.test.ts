import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('function names', () => {
  it.for(['forks', 'vmThreads'] as const)(
    'uses the function name in the %s pool',
    async (pool, { onTestFinished }) => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          'fixtures/describeFunctionName.test.ts',
          '--reporters=verbose',
          '--pool',
          pool,
          ...(pool === 'vmThreads' ? ['--pool.memoryLimit', '256MB'] : []),
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: __dirname,
          },
        },
      });

      await expectExecSuccess();
      expect(cli.stdout).toContain('Component');
      expect(cli.stdout).toContain('testName');
      expect(cli.stdout).toContain('tableCaseName');
    },
  );
});
