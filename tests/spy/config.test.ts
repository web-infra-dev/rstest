import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('test clearMocks config', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/clearMocks.test', '--clearMocks'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(0);
});

it('test restoreMocks config', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/restoreMocks.test', '--restoreMocks'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(0);
});
