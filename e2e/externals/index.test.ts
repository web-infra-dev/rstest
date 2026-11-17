import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test externals', () => {
  it('should external node_modules by default', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/index.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });
});

describe.for(['mutable', 'frozen'])('shared %s externals arrays', (mode) => {
  it.for(['forks', 'threads', 'vmForks', 'vmThreads'])(
    'runs mixed environments under %s',
    async (pool, { onTestFinished }) => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--config',
          './fixtures/rstest.sharedExternals.config.mts',
          '--pool',
          pool,
        ],
        options: {
          nodeOptions: {
            cwd: __dirname,
            env: { FREEZE_EXTERNALS: String(mode === 'frozen') },
          },
        },
        onTestFinished,
      });
      await expectExecSuccess();
      expect(cli.stdout).toContain('Test Files 3 passed');
      expect(cli.stdout).toContain('Tests 3 passed');
    },
  );
});
