import { execFileSync } from 'node:child_process';
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
    fse.copySync(
      join(__dirname, './fixtures/test-vm-external'),
      join(__dirname, './node_modules/test-vm-external'),
    );
    fse.copySync(
      join(__dirname, './fixtures/test-vm-external/helper.cjs'),
      join(
        __dirname,
        './node_modules/test-vm-external/node_modules/legacy/index.js',
      ),
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
    const wasmPath = join(
      __dirname,
      './node_modules/test-vm-external/external.wasm',
    );
    fse.writeFileSync(wasmPath, wasmSource);
    onTestFinished(() => fse.removeSync(wasmPath));

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

  it.each([
    { flags: [] },
    { flags: ['--no-addons'] },
    { flags: ['--no-addons', '--no-experimental-require-module'] },
    { flags: ['--conditions=custom condition'] },
  ])(
    'uses native require conditions with worker flags $flags',
    async ({ flags }) => {
      const entry = join(
        __dirname,
        'node_modules/test-vm-external/conditions/entry.cjs',
      );
      const expected = execFileSync(
        process.execPath,
        [
          ...flags,
          '-e',
          `console.log(JSON.stringify(require(${JSON.stringify(entry)})))`,
        ],
        { encoding: 'utf8' },
      );
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          './fixtures/vmConditions.test.ts',
          '-c',
          './fixtures/rstest.vmExternal.config.mts',
          ...flags.map((flag) => `--pool.execArgv=${flag}`),
        ],
        options: {
          nodeOptions: {
            cwd: __dirname,
            env: { RSTEST_EXPECTED_REQUIRE_CONDITIONS: expected },
          },
        },
      });
      await expectExecSuccess();
    },
  );
});
