import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it.each(['default', 'stack', 'list', 'parallel'])(
  'runs hooks in %s order',
  async (hooks) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.sequence.config.mts'],
      options: {
        nodeOptions: { cwd: __dirname, env: { HOOK_ORDER: hooks } },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain(
      `HOOK_ORDER_OK:${hooks === 'default' ? 'stack' : hooks}`,
    );
  },
);

it.each(['beforeAll', 'beforeEach', 'afterEach', 'afterAll', 'timeout'])(
  'waits for all parallel %s hooks and reports each failure',
  async (failure) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.sequence.config.mts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: { HOOK_ORDER: 'parallel', HOOK_FAILURE: failure },
        },
      },
    });
    await cli.exec;
    expect(cli.exec.exitCode).toBe(1);
    expect(cli.stderr).toContain(
      failure === 'timeout'
        ? 'beforeEach hook timed out in 1000ms'
        : `PARALLEL_FAILURE:${failure}:1`,
    );
    expect(cli.stderr).toContain(`PARALLEL_FAILURE:${failure}:2`);
    expect(cli.stdout).toContain(`PARALLEL_FAILURE_DRAINED:${failure}`);
  },
);

it('runs parallel hooks serially when maxConcurrency is one', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', '-c', 'rstest.sequence.config.mts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
        env: { HOOK_ORDER: 'parallel', HOOK_CONCURRENCY: '1' },
      },
    },
  });
  await expectExecSuccess();
  expect(cli.stdout).toContain('HOOK_ORDER_OK:parallel');
});

it('rejects fixture cycles across parallel hook dependency walks', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', '-c', 'rstest.sequence.config.mts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
        env: { HOOK_ORDER: 'parallel', HOOK_FAILURE: 'cycle' },
      },
    },
  });
  await cli.exec;
  expect(cli.exec.exitCode).toBe(1);
  expect(cli.stderr).toContain('Circular fixture dependency');
  expect(cli.stderr).not.toContain('hook timed out');
  expect(cli.stdout).toContain('PARALLEL_CYCLE_REJECTED');
});

it.each(['fixture-error', 'fixture-timeout'])(
  'preserves sibling hooks after parallel %s',
  async (failure) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.sequence.config.mts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: { HOOK_ORDER: 'parallel', HOOK_FAILURE: failure },
        },
      },
    });
    await cli.exec;
    expect(cli.exec.exitCode).toBe(1);
    for (const hook of ['beforeEach', 'afterEach']) {
      expect(cli.stderr).toContain(
        failure === 'fixture-error'
          ? `FIXTURE_SETUP_FAILED:${hook}:unrelated`
          : `${hook} hook timed out in 50ms`,
      );
      for (const scope of failure === 'fixture-timeout'
        ? ['unrelated', 'shared']
        : ['unrelated']) {
        expect(cli.stderr).toContain(`SIBLING_HOOK_FAILED:${hook}:${scope}`);
        expect(cli.stdout).toContain(
          `PARALLEL_FIXTURES_DRAINED:${hook}:${scope}`,
        );
      }
    }
  },
);
