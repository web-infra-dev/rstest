import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('runs worker, file, and test fixture lifecycles', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      'fixtures/workerScopedNamedFixture.test.ts',
      '--isolate=false',
      '--pool.maxWorkers=1',
    ],
    options: { nodeOptions: { cwd: __dirname } },
  });

  await expectExecSuccess();
  expect(`${cli.stdout}\n${cli.stderr}`).toMatch(
    /scope:worker:setup[\s\S]*scope:file:setup[\s\S]*scope:test:setup:1[\s\S]*scope:test:cleanup:worker:file:test:1[\s\S]*scope:test:setup:2[\s\S]*scope:test:cleanup:worker:file:test:2[\s\S]*scope:file:cleanup[\s\S]*scope:worker:cleanup/,
  );
});

it('cleans worker fixtures before an isolated worker exits', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/workerScopedNamedFixture.test.ts'],
    options: { nodeOptions: { cwd: __dirname } },
  });

  await expectExecSuccess();
  expect(`${cli.stdout}\n${cli.stderr}`).toContain('scope:worker:cleanup');
});

it('reports worker fixture cleanup failures', async () => {
  const { cli, expectExecFailed } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      'fixtures/workerCleanupFailure.test.ts',
      '--isolate=false',
      '--pool.maxWorkers=1',
    ],
    options: { nodeOptions: { cwd: __dirname } },
  });

  await expectExecFailed();
  expect(`${cli.stdout}\n${cli.stderr}`).toContain(
    'worker fixture cleanup reached',
  );
});
