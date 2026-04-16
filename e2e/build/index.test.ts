import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
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
  ])('$name config should work correctly', async ({ name }, {
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        `fixtures/${name}`,
        '-c',
        `fixtures/${name}/rstest.config.mts`,
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

  it('should write output to customized distPath.root', async ({
    onTestFinished,
  }) => {
    const defaultOutputPath = join(__dirname, 'dist/.rstest-temp');
    const customOutputPath = join(__dirname, 'custom/.rstest-temp');

    fs.rmSync(defaultOutputPath, { recursive: true, force: true });
    fs.rmSync(join(__dirname, 'custom'), {
      recursive: true,
      force: true,
    });

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/customOutput',
        '-c',
        'fixtures/customOutput/rstest.config.mts',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    expect(fs.existsSync(join(customOutputPath, 'rstest-manifest.json'))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        join(
          customOutputPath,
          process.env.RSTEST_OUTPUT_MODULE === 'false'
            ? 'rstest-runtime.js'
            : 'rstest-runtime.mjs',
        ),
      ),
    ).toBe(true);
    expect(fs.existsSync(join(defaultOutputPath, 'rstest-manifest.json'))).toBe(
      false,
    );
  });
});
