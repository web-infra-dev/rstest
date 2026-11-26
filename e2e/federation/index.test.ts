import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('federation', () => {
  it('should install federation runtime shims when enabled in config', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/basic'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should keep federation runtime shims when isolate is disabled', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--isolate', 'false'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/basic'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should not install federation runtime shims by default', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/disabled'),
        },
      },
    });

    await expectExecSuccess();
  });

  it.each(['forks', 'threads', 'vmForks', 'vmThreads'])(
    'scopes federation to the current project on a reused %s worker',
    async (pool) => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.projects.config.mts',
          '--pool',
          pool,
          '--pool.maxWorkers',
          '1',
          '--isolate',
          'false',
        ],
        options: { nodeOptions: { cwd: join(__dirname, 'fixtures') } },
      });

      await expectExecSuccess();
      const output = cli.stdout + cli.stderr;
      expect(output).toContain('[project:plain]');
      expect(output).not.toContain('[project:mf-');
      const workers = [
        ...output.matchAll(/\[worker:(\d+\/\d+):(mf-a|plain|mf-b)\]/g),
      ];
      expect(workers.map((match) => match[2]).sort()).toEqual([
        'mf-a',
        'mf-b',
        'plain',
      ]);
      expect(new Set(workers.map((match) => match[1])).size).toBe(1);
    },
  );

  it('should enable federation mode via the --federation CLI flag', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--federation'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/cli'),
        },
      },
    });

    await expectExecSuccess();
  });
});
