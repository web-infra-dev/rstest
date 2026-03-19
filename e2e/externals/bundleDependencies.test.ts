import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import fse from 'fs-extra';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distDir = join(__dirname, 'dist/.rstest-temp');

describe('test bundleDependencies', () => {
  it('should externalize dependencies in jsdom when bundleDependencies is false', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/index.test.ts',
        '--testEnvironment=jsdom',
        '-c',
        './fixtures/rstest.noBundleDeps.config.ts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = fse.readFileSync(
      join(distDir, 'fixtures_index~test~ts.mjs'),
      'utf-8',
    );

    // strip-ansi source code should NOT be inlined when externalized
    expect(output).not.toContain('function stripAnsi');
  });

  it('should bundle dependencies in node when bundleDependencies is true', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/index.test.ts',
        '-c',
        './fixtures/rstest.bundleDeps.config.ts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = fse.readFileSync(
      join(distDir, 'fixtures_index~test~ts.mjs'),
      'utf-8',
    );

    // strip-ansi source code should be inlined when bundled
    expect(output).toContain('function stripAnsi');
  });
});
