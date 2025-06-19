import { dirname, join } from 'node:path';
import fse from 'fs-extra';

import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test module filed', () => {
  beforeAll(() => {
    fse.copySync(
      join(__dirname, './fixtures/test-module-filed'),
      join(__dirname, './fixtures/test-pkg/node_modules/test-module-filed'),
    );
  });

  it('should load module correctly with module filed', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/moduleFiled'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });
});
