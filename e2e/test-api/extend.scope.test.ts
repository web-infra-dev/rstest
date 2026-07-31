import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('runs test, file, and worker fixture lifecycles', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      'fixtures/scopedFixtures.test.ts',
      '--isolate=false',
      '--pool.maxWorkers=1',
    ],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecSuccess();

  expect(cli.stdout).toMatch(
    /scope:worker:setup[\s\S]*scope:file:setup[\s\S]*scope:test:setup:1[\s\S]*scope:test:cleanup:worker:file:test:1[\s\S]*scope:test:setup:2[\s\S]*scope:test:cleanup:worker:file:test:2[\s\S]*scope:file:cleanup[\s\S]*scope:worker:cleanup/,
  );
});

for (const isolate of [true, false]) {
  it(`reports worker fixture cleanup failures with isolate=${isolate}`, async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/workerCleanupFailure.test.ts',
        `--isolate=${isolate}`,
        '--pool.maxWorkers=1',
        '--reporters',
        'json',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();
    const report = JSON.parse(cli.stdout.slice(cli.stdout.indexOf('{')));
    expect(report.status).toBe('fail');
    expect(report.unhandledErrors[0].message).toContain(
      'worker fixture cleanup reached',
    );
  });
}

it('reports isolated worker cleanup failures in the current watch cycle', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: [
      'watch',
      'fixtures/workerCleanupFailure.test.ts',
      '--isolate=true',
      '--pool.maxWorkers=1',
      '--disableConsoleIntercept',
    ],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await Promise.all([
    cli.waitForStderr('worker fixture cleanup reached'),
    cli.waitForStdout('Waiting for file changes...'),
  ]);
  expect(cli.log).toContain('Unhandled Error');
  expect(cli.log.indexOf('worker fixture cleanup reached')).toBeLessThan(
    cli.log.indexOf('Waiting for file changes...'),
  );
});
