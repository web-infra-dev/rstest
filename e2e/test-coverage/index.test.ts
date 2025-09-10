import { join } from 'node:path';
import { expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

it('coverage-istanbul', async () => {
  const { expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });

  await expectExecSuccess();

  expect(
    fs.existsSync(join(__dirname, 'fixtures/coverage/coverage-final.json')),
  ).toBeTruthy();
});
