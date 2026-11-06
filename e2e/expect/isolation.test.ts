import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const cwd = fileURLToPath(new URL('./fixtures/isolation', import.meta.url));

describe.for(['forks', 'threads', 'vmForks', 'vmThreads'] as const)(
  'expect extensions in %s',
  (pool) => {
    const vm = pool === 'vmForks' || pool === 'vmThreads';

    it.for([
      { isolate: true, projects: false },
      { isolate: true, projects: true },
      { isolate: false, projects: false },
      { isolate: false, projects: true },
    ])(
      'respects file isolation: %j',
      async ({ isolate, projects }, { onTestFinished }) => {
        const { cli, expectExecSuccess, expectLog } = await runRstestCli({
          command: 'rstest',
          args: ['run', '--pool', pool, '--isolate', String(isolate)],
          onTestFinished,
          options: {
            nodeOptions: {
              cwd,
              env: {
                EXPECT_EXTENSION_PROJECTS: String(projects),
                EXPECT_EXTENSION_SHARED: String(!vm && !isolate),
              },
            },
          },
        });
        await expectExecSuccess();
        const files = projects ? 4 : 2;
        expectLog(`Test Files ${files} passed`);
        const workers = [
          ...cli.stdout.matchAll(/EXPECT_EXTENSION_WORKER:(\d+:\d+)/g),
        ].map((match) => match[1]);
        expect(workers).toHaveLength(files);
        if (vm || !isolate) {
          expect(new Set(workers).size).toBe(1);
        }
      },
    );

    it.skipIf(!vm).for(['setup', 'test', 'teardown'])(
      'restores expect extensions after a %s failure',
      async (failure, { onTestFinished }) => {
        const { cli, expectExecFailed, expectLog } = await runRstestCli({
          command: 'rstest',
          args: ['run', '--pool', pool, '--isolate=false'],
          onTestFinished,
          options: {
            nodeOptions: {
              cwd,
              env: {
                EXPECT_EXTENSION_PROJECTS: 'true',
                EXPECT_EXTENSION_FAILURE: failure,
              },
            },
          },
        });
        await expectExecFailed();
        expectLog('Test Files 1 failed | 3 passed');
        expect(`${cli.stdout}\n${cli.stderr}`).toContain(
          `EXPECT_EXTENSION_EXPECTED_${failure.toUpperCase()}_FAILURE`,
        );
      },
    );
  },
);
