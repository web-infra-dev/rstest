import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it } from '@rstest/core';
import fse from 'fs-extra';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test module field', () => {
  beforeAll(() => {
    fse.copySync(
      join(__dirname, './fixtures/test-module-field'),
      join(__dirname, './fixtures/test-pkg/node_modules/test-module-field'),
    );
  });

  it('should load pkg correctly with module field', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/moduleField'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('should load pkg correctly with module field in dom environment', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/moduleField', '--testEnvironment=jsdom'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });
});
