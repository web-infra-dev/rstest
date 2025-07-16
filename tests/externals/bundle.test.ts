import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import fse from 'fs-extra';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test externals false', () => {
  beforeAll(() => {
    fse.copySync(
      join(__dirname, './fixtures/test-bundle'),
      join(__dirname, './fixtures/test-pkg/node_modules/test-bundle'),
    );
  });

  it('should bundle node_modules', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/bundle.test.ts',
        '-c',
        './fixtures/rstest.bundle.config.ts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });
});
