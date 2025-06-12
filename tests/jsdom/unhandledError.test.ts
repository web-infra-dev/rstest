import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('should catch error correctly', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'test/unhandledError'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });

  await cli.exec;

  expect(cli.exec.process?.exitCode).toBe(1);
});
