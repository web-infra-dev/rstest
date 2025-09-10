import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

it('should import rstest correctly in node_modules', async () => {
  await prepareFixtures({
    fixturesPath: join(__dirname, './fixtures/test-rstest-import'),
    fixturesTargetPath: join(
      __dirname,
      './fixtures/node_modules/rstest-import',
    ),
  });
  const { expectExecSuccess, expectLog } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'runner.test.ts'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });
  await expectExecSuccess();
  expectLog('Tests 2 passed | 1 todo');
});

it('should use rstest global APIs correctly in node_modules', async () => {
  await prepareFixtures({
    fixturesPath: join(__dirname, './fixtures/test-rstest-globals'),
    fixturesTargetPath: join(
      __dirname,
      './fixtures/node_modules/rstest-globals',
    ),
  });
  const { expectExecSuccess, expectLog } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'globals.test.ts', '--globals'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });
  await expectExecSuccess();
  expectLog('Tests 2 passed | 1 todo');
});
