import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { normalize } from 'pathe';
import { x } from 'tinyexec';
import { getCoverageSummaryEntry, runRstestCli } from '../scripts';
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
    it.for(['forks', 'vmThreads'] as const)(
      'maps generated coverage back to TypeScript sources under %s',
      async (pool, { onTestFinished }) => {
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

        if (provider === 'istanbul') {
          for (const inlineSourceMap of [false, true]) {
            if (inlineSourceMap) {
              const generatedFile = join(generatedPath, 'dist/sourcemap.js');
              const code = fs.readFileSync(generatedFile, 'utf8');
              const sourceMap = fs.readFileSync(
                `${generatedFile}.map`,
                'base64',
              );
              const externalUrl = '//# sourceMappingURL=sourcemap.js.map';
              expect(code).toContain(externalUrl);
              fs.writeFileSync(
                generatedFile,
                code.replace(
                  externalUrl,
                  `//# sourceMappingURL=data:application/json;base64,${sourceMap}`,
                ),
              );
            }
            const untested = await runRstestCli({
              command: 'rstest',
              args: [
                'run',
                '-c',
                'rstest.untested.config.ts',
                '--pool',
                pool,
                ...(pool === 'vmThreads'
                  ? ['--pool.memoryLimit', '256MB']
                  : []),
                '--coverage.reportsDirectory',
                reportsDirectory,
                'test/date.test.ts',
              ],
              options: { nodeOptions: { cwd: fixturePath } },
            });
            await untested.expectExecSuccess();

            const summary: Record<
              string,
              Record<string, { total: number; covered: number }>
            > = fs.readJsonSync(
              join(fixturePath, reportsDirectory, 'coverage-summary.json'),
            );
            const sourcePath = normalize(join(fixturePath, 'src/sourcemap.ts'));
            const ignoredPath = normalize(
              join(fixturePath, 'src/untested.jsx'),
            );
            expect(Object.keys(summary).map(normalize).sort()).toEqual(
              ['total', sourcePath, ignoredPath].sort(),
            );
            const sourceSummary = getCoverageSummaryEntry(summary, sourcePath);
            expect(sourceSummary).toMatchObject({
              lines: { covered: 0 },
              statements: { covered: 0 },
              functions: { covered: 0 },
              branches: { covered: 0 },
            });
            expect(sourceSummary?.statements?.total).toBeGreaterThan(0);
            expect(getCoverageSummaryEntry(summary, ignoredPath)).toMatchObject(
              {
                statements: { covered: 0 },
                functions: { total: 0, covered: 0 },
                branches: { total: 0, covered: 0 },
              },
            );
            const report = fs.readJsonSync(
              join(fixturePath, reportsDirectory, 'coverage-final.json'),
            );
            expect(report[ignoredPath].fnMap).toEqual({});
            expect(report[ignoredPath].branchMap).toEqual({});
            const statements: { start: { line: number } }[] = Object.values(
              report[ignoredPath].statementMap,
            );
            expect(new Set(statements.map(({ start }) => start.line))).toEqual(
              new Set([1]),
            );
          }
        }
      },
    );
  });
}
