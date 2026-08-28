import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { x } from 'tinyexec';
import { runRstestCli } from '../scripts';
import { coverageProviders } from './providers';

const isCommonJs = process.env.RSTEST_OUTPUT_MODULE === 'false';
const expectedSummary = {
  istanbul: {
    source: /^sourcemap\.ts\|87\.5\|75\|100\|87\.5\|16$/,
    allFiles: /^Allfiles\|87\.5\|75\|100\|87\.5\|$/,
  },
  v8: {
    source: isCommonJs
      ? /^sourcemap\.ts\|100\|75\|100\|100\|13$/
      : /^sourcemap\.ts\|87\.5\|75\|100\|87\.5\|16$/,
    allFiles: isCommonJs
      ? /^Allfiles\|100\|75\|100\|100\|$/
      : /^Allfiles\|87\.5\|75\|100\|87\.5\|$/,
  },
} as const;

for (const provider of coverageProviders) {
  describe(`coverage sourcemaps (${provider})`, () => {
    for (const pool of ['forks', 'vmThreads'] as const) {
      it(`maps generated coverage back to TypeScript sources under ${pool}`, async ({
        onTestFinished,
      }) => {
        const fixturePath = join(__dirname, 'fixtures');
        const reportsDirectory = `test-temp-${provider}-${pool}-sourcemap-coverage`;
        const generatedPath = join(fixturePath, 'test-temp-sourcemap');
        onTestFinished(() => {
          fs.removeSync(generatedPath);
          fs.removeSync(join(fixturePath, reportsDirectory));
        });

        // 1. Execute tsc in the test case to generate JS files with sourcemaps
        const tsc = x(
          'npx',
          [
            'tsc',
            '--ignoreConfig',
            '--sourceMap',
            '--module',
            'esnext',
            '--target',
            'esnext',
            '--moduleResolution',
            'bundler',
            '--outDir',
            'test-temp-sourcemap/dist',
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
            '--pool',
            pool,
            ...(pool === 'vmThreads' ? ['--pool.memoryLimit', '256MB'] : []),
            '--coverage.provider',
            provider,
            '--coverage.reportsDirectory',
            reportsDirectory,
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

        expect(sourcemapLog).toMatch(expectedSummary[provider].source);

        const allFilesLog = logs
          .find((log) => log.includes('All files'))
          ?.replaceAll(' ', '');

        expect(allFilesLog).toMatch(expectedSummary[provider].allFiles);
      });
    }
  });
}
