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
