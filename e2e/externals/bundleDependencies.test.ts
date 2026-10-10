import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distDir = join(__dirname, 'dist-deps/.rstest-temp');

function resolveTestOutputFile(testName = 'index'): string | undefined {
  const ext = process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '.mjs' : '.js';
  const file = join(distDir, `fixtures_${testName}~test~ts${ext}`);

  if (existsSync(file)) {
    return file;
  }

  const matchedFile = readdirSync(distDir).find(
    (entry) =>
      entry.startsWith(`fixtures_${testName}~test~ts`) && entry.endsWith(ext),
  );

  if (matchedFile) {
    return join(distDir, matchedFile);
  }

  return undefined;
}

async function readTestOutput(testName = 'index'): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const file = resolveTestOutputFile(testName);

    if (file) {
      return readFileSync(file, 'utf-8');
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
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
        './fixtures/rstest.noBundleDeps.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = await readTestOutput();

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
        './fixtures/rstest.debug.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = await readTestOutput();

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
        './fixtures/rstest.bundleDeps.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = await readTestOutput();

    // strip-ansi source code should be inlined when bundled
    expect(output).toContain('function stripAnsi');
  });

  it('should bundle only the named dependencies when bundleDependencies is an array', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/namedBundleDependencies.test.ts',
        '-c',
        './fixtures/rstest.bundleNamedDeps.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = await readTestOutput('namedBundleDependencies');

    expect(output).toContain("const VERSION = '4.17.21';");
    expect(output).not.toContain("throw new Error('dirname is not defined');");
  });

  it('should bundle relative imports inside named dependencies', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/namedBundleRelative.test.ts',
        '-c',
        './fixtures/rstest.bundleRelativeDeps.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = await readTestOutput('namedBundleRelative');

    expect(output).toContain("exports.a = 'world';");
    expect(output).not.toContain('__webpack_require__("test-interop")');
  });

  it('should bundle relative imports when a package subpath is listed', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/namedBundleRelative.test.ts',
        '-c',
        './fixtures/rstest.bundleRelativeDepsSubpath.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = await readTestOutput('namedBundleRelative');

    expect(output).toContain("exports.a = 'world';");
    expect(output).not.toContain('__webpack_require__("test-interop")');
  });

  it('should bundle relative imports when a package glob is listed', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './fixtures/namedBundleRelative.test.ts',
        '-c',
        './fixtures/rstest.bundleRelativeDepsGlob.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const output = await readTestOutput('namedBundleRelative');

    expect(output).toContain("exports.a = 'world';");
    expect(output).not.toContain('__webpack_require__("test-interop")');
  });
});
