import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it } from '@rstest/core';
import fse from 'fs-extra';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FAKE_PACKAGES = [
  'boom-on-eval',
  'boom-esm',
  'sfx-mod',
  'env-singleton',
  'consumer-pkg',
  'cjs-shaped',
];

// https://github.com/web-infra-dev/rstest/issues/1456
describe('rs.mock of an externalized dependency', () => {
  beforeAll(() => {
    for (const pkg of FAKE_PACKAGES) {
      fse.copySync(
        join(__dirname, './fixtures/mock-eval', pkg),
        join(__dirname, './fixtures/test-mock-eval/node_modules', pkg),
      );
    }
  });

  it('should prevent the real externalized module from being evaluated', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/test-mock-eval'),
        },
      },
    });

    await expectExecSuccess();
  });

  // Depends on #1485 (native `module.registerHooks` mock bridge): the mock
  // must reach an UNMOCKED externalized package's internal static import of
  // the mocked module, which is resolved by Node's loader outside the bundle.
  // The fixture (fixtures/test-mock-eval/internal/) is in place — un-skip
  // once #1485 lands.
  it.skip('should apply the mock inside an externalized package that imports it', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', './rstest.internal.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/test-mock-eval'),
        },
      },
    });

    await expectExecSuccess();
  });
});
