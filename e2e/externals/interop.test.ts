import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it } from '@rstest/core';
import fse from 'fs-extra';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test interop', () => {
  beforeAll(() => {
    fse.copySync(
      join(__dirname, './fixtures/test-interop'),
      join(__dirname, './node_modules/test-interop'),
    );
    fse.copySync(
      join(__dirname, './fixtures/test-interop'),
      join(__dirname, './fixtures/test-pkg/node_modules/test-interop'),
    );
    fse.copySync(
      join(__dirname, './fixtures/test-lodash'),
      join(__dirname, './fixtures/test-pkg/node_modules/test-lodash'),
    );
  });

  it('should interopDefault correctly in jsdom test environment', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/interopDefault', '--testEnvironment=jsdom'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('should interopDefault correctly in node test environment', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/interopDefault', '--testEnvironment=node'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('should interop invalid named exports correctly', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args:
        process.env.RSTEST_OUTPUT_MODULE !== 'false'
          ? [
              'run',
              './fixtures/interopLodash',
              '--testEnvironment=node',
              '-c',
              './fixtures/rstest.lodash.config.mts',
            ]
          : ['run', './fixtures/interopLodash', '--testEnvironment=node'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('should execute external modules in the vmThreads realm', async ({
    onTestFinished,
  }) => {
    const wasmSource = Buffer.from(
      'AGFzbQEAAAABBQFgAAF/AhcBDy4vd2FzbS1nbHVlLm1qcwNpbXAAAAMCAQAHBwEDZXhwAAEKBgEEABAACw==',
      'base64',
    );
    const wasmPaths = [
      join(__dirname, './node_modules/test-interop/external.wasm'),
      join(
        __dirname,
        './fixtures/test-pkg/node_modules/test-interop/external.wasm',
      ),
    ];
    for (const wasmPath of wasmPaths) {
      fse.writeFileSync(wasmPath, wasmSource);
    }
    onTestFinished(() => {
      for (const wasmPath of wasmPaths) {
        fse.removeSync(wasmPath);
      }
    });

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/vmRealm.test.ts',
        '-c',
        './fixtures/rstest.vmExternal.config.mts',
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
