import { dirname, join } from 'node:path';
import fse from 'fs-extra';

import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from '@rstest/core';
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

  it('should load module correctly with module field', async () => {
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
});
