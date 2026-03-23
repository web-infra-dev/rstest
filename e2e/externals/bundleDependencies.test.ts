import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distDir = join(__dirname, 'dist/.rstest-temp');

function readTestOutput(): string {
  const ext = process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '.mjs' : '.js';
  const file = join(distDir, `fixtures_index~test~ts${ext}`);
  if (existsSync(file)) {
    return readFileSync(file, 'utf-8');
  }
  throw new Error('No test output file found');
}

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

    const output = readTestOutput();

    // strip-ansi source code should NOT be inlined when externalized
    expect(output).not.toContain('function stripAnsi');
  });

  it('should use testEnvironment-based behavior when bundleDependencies is unset', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/index.test.ts',
        '--testEnvironment=jsdom',
        '-c',
        './fixtures/rstest.debug.config.ts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = readTestOutput();

    // jsdom should still bundle dependencies by default
    expect(output).toContain('function stripAnsi');
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

    const output = readTestOutput();

    // strip-ansi source code should be inlined when bundled
    expect(output).toContain('function stripAnsi');
  });
});
