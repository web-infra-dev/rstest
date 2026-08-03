import { rm } from 'node:fs/promises';
import { join } from 'node:path';
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

it('cleans worker fixtures before the isolated test environment', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      'fixtures/workerCleanupEnvironment.test.ts',
      '--testEnvironment=jsdom',
      '--pool.maxWorkers=1',
    ],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecSuccess();
  expect(cli.stdout).toContain('worker cleanup document: BODY');
});

it('bounds file fixture cleanup in the host', async () => {
  const start = Date.now();
  const { cli, expectExecFailed } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/fileCleanupTimeout.test.ts', '--pool.maxWorkers=1'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecFailed();
  expect(Date.now() - start).toBeLessThan(20_000);
  expect(`${cli.stdout}\n${cli.stderr}`).toContain(
    'File fixture cleanup did not finish within 10000ms',
  );
});

it('bounds isolated worker fixture cleanup in the host', async () => {
  const start = Date.now();
  const { cli, expectExecFailed } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      'fixtures/workerCleanupTimeout.test.ts',
      '--pool.maxWorkers=1',
    ],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecFailed();
  expect(Date.now() - start).toBeLessThan(20_000);
  expect(`${cli.stdout}\n${cli.stderr}`).toContain(
    'Worker fixture cleanup did not finish within 10000ms',
  );
});

it('bounds scoped fixture setup with the test timeout', async () => {
  const start = Date.now();
  const { cli, expectExecFailed } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/scopedSetupTimeout.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecFailed();
  expect(Date.now() - start).toBeLessThan(10_000);
  expect(`${cli.stdout}\n${cli.stderr}`).toContain(
    'fixture setup timed out in 100ms',
  );
});

it('rejects scoped fixtures declared inside a suite', async () => {
  const { cli, expectExecFailed } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/nestedScopedFixture.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecFailed();
  expect(`${cli.stdout}\n${cli.stderr}`).toContain(
    'worker-scoped fixtures must be defined at the top level of the test file',
  );
});

it('includes file fixture cleanup in the file duration', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', '-c', 'rstest.scoped-duration.config.mts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecSuccess();
  const duration = /SCOPED_FILE_DURATION=(\d+)/.exec(cli.stdout)?.[1];
  expect(Number(duration)).toBeGreaterThanOrEqual(100);
});

it('reports execution and file fixture cleanup failures together', async () => {
  const snapshotPath = join(
    __dirname,
    'fixtures',
    '.combined-cleanup-error.snap',
  );
  await rm(snapshotPath, { recursive: true, force: true });

  try {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        'rstest.combined-cleanup-error.config.mts',
        '--reporters',
        'json',
        '--update',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();
    const report = JSON.parse(cli.stdout.slice(cli.stdout.indexOf('{')));
    const message = report.files[0].errors[0].message;
    expect(message).toContain('Test execution failed:');
    expect(message).toContain('first file fixture cleanup root cause');
    expect(message).toContain('second file fixture cleanup root cause');
  } finally {
    await rm(snapshotPath, { recursive: true, force: true });
  }
});
