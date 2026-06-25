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
    { name: 'modifyRstestConfig' },
    { name: 'tools/rspack' },
    { name: 'decorators' },
  ])(
    '$name config should work correctly',
    async ({ name }, { onTestFinished }) => {
      // Run each fixture inside its own directory so the default output path
      // (dist/.rstest-temp) is scoped to that fixture and never collides with
      // sibling test files that also spawn rstest under e2e/build/.
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures', name),
          },
        },
      });

      await expectExecSuccess();
    },
  );

  it('should write output to customized distPath.root', async ({
    onTestFinished,
  }) => {
    const fixtureDir = join(__dirname, 'fixtures/customOutput');
    const defaultOutputPath = join(fixtureDir, 'dist/.rstest-temp');
    const customOutputPath = join(fixtureDir, 'custom/.rstest-temp');

    fs.rmSync(defaultOutputPath, { recursive: true, force: true });
    fs.rmSync(join(fixtureDir, 'custom'), {
      recursive: true,
      force: true,
    });

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: fixtureDir,
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
