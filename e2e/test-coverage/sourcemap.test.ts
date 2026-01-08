import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { x } from 'tinyexec';
import { runRstestCli } from '../scripts';

describe('test coverage-istanbul sourcemap', () => {
  it('should map coverage back to source files using sourcemaps', async () => {
    const fixturePath = join(__dirname, 'fixtures');

    // 1. Execute tsc in the test case to generate JS files with sourcemaps
    const tsc = x(
      'npx',
      [
        'tsc',
        '--sourceMap',
        '--module',
        'esnext',
        '--target',
        'esnext',
        '--moduleResolution',
        'node',
        '--outDir',
        'test-temp-sourcemap-dist',
        'src/sourcemap.ts',
      ],
      {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    );
    await tsc;

    if (tsc.process?.exitCode !== 0) {
      throw new Error(
        `tsc compilation failed with exit code: ${tsc.process?.exitCode}`,
      );
    }

    // 2. Run rstest with configuration including the compiled JS file
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        'rstest.sourcemap.config.ts',
        'test/sourcemapMapping.test.ts',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    // 3. Verify that the coverage report shows the original .ts file instead of the compiled .js file
    expectLog('sourcemap.ts', logs);

    const sourcemapLog = logs
      .find((log) => log.includes('sourcemap.ts'))
      ?.replaceAll(' ', '');

    expect(sourcemapLog).toMatchInlineSnapshot(
      `"sourcemap.ts|87.5|75|100|87.5|16"`,
    );

    const allFilesLog = logs
      .find((log) => log.includes('All files'))
      ?.replaceAll(' ', '');

    expect(allFilesLog).toMatchInlineSnapshot(`"Allfiles|87.5|75|100|87.5|"`);
  });
});
