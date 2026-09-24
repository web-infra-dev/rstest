import { fileURLToPath } from 'node:url';
import { it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('keeps the real package lazy for runtime-only imports', async ({
  onTestFinished,
}) => {
  const { expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run'],
    onTestFinished,
    options: {
      nodeOptions: {
        cwd: fileURLToPath(new URL('./fixtures', import.meta.url)),
      },
    },
  });
  await expectExecSuccess();
});

it('exposes package helpers in vmForks', async ({ onTestFinished }) => {
  const { expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'basic/test/coreExports.test.ts', '--pool', 'vmForks'],
    onTestFinished,
    options: {
      nodeOptions: {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
      },
    },
  });
  await expectExecSuccess();
});
