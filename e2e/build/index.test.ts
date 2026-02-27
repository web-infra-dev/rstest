import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test build config', () => {
  it.concurrent.for([
    { name: 'define' },
    { name: 'alias' },
    { name: 'plugin' },
    { name: 'tools/rspack' },
    { name: 'decorators' },
    { name: 'moduleNameMapper' },
    {
      name: 'moduleNameMapperHappyDom',
      fixtureDir: 'moduleNameMapper',
      testEnvironment: 'happy-dom',
    },
  ])('$name config should work correctly', async ({
    name,
    fixtureDir = name,
    testEnvironment,
  }, { onTestFinished }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        `fixtures/${fixtureDir}`,
        '-c',
        `fixtures/${fixtureDir}/rstest.config.ts`,
        ...(testEnvironment ? ['--testEnvironment', testEnvironment] : []),
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });
});
