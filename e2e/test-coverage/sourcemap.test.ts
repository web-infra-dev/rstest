import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { rspack } from '@rsbuild/core';
import fs from 'fs-extra';
import { normalize } from 'pathe';
import { x } from 'tinyexec';
import { getCoverageSummaryEntry, runRstestCli } from '../scripts';
import { coverageProviders } from './providers';

const expectedSummary = {
  istanbul: {
    source: /^sourcemap\.ts\|87\.5\|75\|100\|87\.5\|16$/,
    allFiles: /^Allfiles\|87\.5\|75\|100\|87\.5\|$/,
  },
  v8: {
    source: /^sourcemap\.ts\|87\.5\|75\|100\|87\.5\|16$/,
    allFiles: /^Allfiles\|87\.5\|75\|100\|87\.5\|$/,
  },
} as const;

it.for(['forks', 'vmThreads', 'browser'] as const)(
  'restores source ranges after merging and inlining under %s',
  async (runtime, { onTestFinished }) => {
    const fixturePath = join(__dirname, 'fixtures');
    const generatedPath = join(fixturePath, 'test-temp-merged');
    const reportsDirectory = `test-temp-merged-statements-${runtime}`;
    const sourcePath = join(fixturePath, 'mergedStatements.ts');
    onTestFinished(() => {
      fs.removeSync(generatedPath);
      fs.removeSync(join(fixturePath, reportsDirectory));
    });
    const result = await rspack.experiments.swc.transform(
      fs.readFileSync(sourcePath, 'utf8'),
      {
        filename: sourcePath,
        sourceMaps: true,
        inlineSourcesContent: true,
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'es2022',
          minify: {
            compress: { defaults: true, sequences: true },
            mangle: false,
          },
        },
      },
    );
    expect(result.code).toMatch(/log\(.+\),\s*log\(/);
    fs.outputFileSync(
      join(generatedPath, 'index.js'),
      `${result.code}\n//# sourceMappingURL=index.js.map`,
    );
    fs.outputFileSync(join(generatedPath, 'index.js.map'), result.map!);

    const run = async (
      include: string | undefined,
      directory: string,
      html: boolean,
      native = false,
    ) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.sourcemap.config.ts',
          native
            ? 'test/missingSource.fixture.ts'
            : 'test/mergedStatements.fixture.ts',
          ...(runtime === 'browser'
            ? ['--browser', '--browser.headless']
            : ['--pool', runtime]),
          '--coverage.provider',
          'v8',
          ...(include ? ['--coverage.include', include] : []),
          '--coverage.reporters',
          'json',
          ...(html ? ['--coverage.reporters', 'html'] : []),
          '--coverage.reportsDirectory',
          directory,
        ],
        options: { nodeOptions: { cwd: fixturePath } },
      });
      await expectExecSuccess();
    };
    await run('mergedStatements.ts', reportsDirectory, true);

    const report = fs.readJsonSync(
      join(fixturePath, reportsDirectory, 'coverage-final.json'),
    ) as Record<
      string,
      {
        statementMap: Record<
          string,
          {
            start: { line: number; column: number };
            end: { line: number; column: number | null };
          }
        >;
        s: Record<string, number>;
      }
    >;
    const coverage = getCoverageSummaryEntry(report, sourcePath)!;
    const statementsAt = (line: number) =>
      Object.entries(coverage.statementMap)
        .filter(([, location]) => location.start.line === line)
        .map(([id]) => coverage.s[id]);
    expect(statementsAt(2)).toEqual([1]);
    expect(statementsAt(3)).toEqual([1]);
    expect(statementsAt(7)).toEqual([0]);
    expect(statementsAt(8)).toEqual([0]);
    expect(statementsAt(12)).toEqual([1]);
    expect(statementsAt(17)).toEqual([0]);
    expect(statementsAt(19)).toEqual([1]);
    expect(statementsAt(20)).toEqual([1]);
    expect(statementsAt(25)).toEqual([1]);
    expect(statementsAt(30)).toEqual([0]);
    for (const { start, end } of Object.values(coverage.statementMap)) {
      expect(end.line).toBeGreaterThanOrEqual(start.line);
      if (end.line === start.line && end.column !== null) {
        expect(end.column).toBeGreaterThanOrEqual(start.column);
      }
    }
    const html = fs.readFileSync(
      join(fixturePath, reportsDirectory, 'mergedStatements.ts.html'),
      'utf8',
    );
    for (const message of ['third', 'fourth']) {
      expect(html).toMatch(
        new RegExp(
          `<span class="cstat-no"[^>]*>[^<]*log\\('${message}'\\);</span>`,
        ),
      );
    }
    expect(html).toMatch(
      /<span class="cstat-no"[^>]*>[^<]*return log\(words\.join\(':'\)\);<\/span>/,
    );
    if (runtime === 'browser') return;
    for (const format of ['inline', 'external']) {
      const directory = `${reportsDirectory}-disk-${format}`;
      onTestFinished(() => fs.removeSync(join(fixturePath, directory)));
      const map = JSON.stringify({
        ...JSON.parse(result.map!),
        sources: ['../mergedStatements.ts'],
        sourcesContent: undefined,
      });
      const mapUrl =
        format === 'inline'
          ? `data:application/json;base64,${Buffer.from(map).toString('base64')}`
          : 'index.js.map';
      fs.outputFileSync(
        join(generatedPath, 'index.js'),
        `${result.code}\n//# sourceMappingURL=${mapUrl}`,
      );
      fs.outputFileSync(join(generatedPath, 'index.js.map'), map);
      await run('mergedStatements.ts', directory, false, true);
      const diskReport = fs.readJsonSync(
        join(fixturePath, directory, 'coverage-final.json'),
      ) as typeof report;
      const diskSource = getCoverageSummaryEntry(diskReport, sourcePath)!;
      for (const line of [7, 8]) {
        const entries = Object.entries(diskSource.statementMap).filter(
          ([, loc]) => loc.start.line === line,
        );
        expect(entries).toHaveLength(1);
        expect(diskSource.s[entries[0]![0]]).toBe(0);
      }
    }
    for (const [index, source] of [
      null,
      'export const invalid = ;',
    ].entries()) {
      const directory = `${reportsDirectory}-missing-${index}`;
      onTestFinished(() => fs.removeSync(join(fixturePath, directory)));
      const missingPath = join(fixturePath, 'missing-original.ts');
      const code = [
        'export function inlinedValue(log) {',
        "log('returned');",
        '}',
        'export function inlinedUncovered(log) {',
        "log('uncalled');",
        '}',
      ].join('\n');
      // Map each call from line 25/30 back to line 3, independent of minifier choices.
      const map = {
        version: 3,
        names: [],
        sources: [missingPath],
        sourcesContent: [source],
        mappings: 'AAwBA;AAAA,IAtBA;AAAA;AA2BA;AAAA,IA3BA;AAAA',
      };
      fs.outputFileSync(
        join(generatedPath, 'index.js'),
        `${code}\n//# sourceMappingURL=index.js.map`,
      );
      fs.outputFileSync(
        join(generatedPath, 'index.js.map'),
        JSON.stringify(map),
      );
      // Explicit include globs retain only files found on disk.
      await run(undefined, directory, false, true);
      const missingReport = fs.readJsonSync(
        join(fixturePath, directory, 'coverage-final.json'),
      ) as typeof report;
      const missing = getCoverageSummaryEntry(missingReport, missingPath)!;
      expect(missing, Object.keys(missingReport).join(', ')).toBeDefined();
      for (const [line, count] of [
        [25, 1],
        [30, 0],
      ]) {
        const entries = Object.entries(missing.statementMap).filter(
          ([, loc]) => loc.start.line === line,
        );
        expect(entries).toHaveLength(1);
        const [id, loc] = entries[0]!;
        expect(missing.s[id]).toBe(count);
        expect(loc.end.line).toBeGreaterThanOrEqual(loc.start.line);
      }
    }
  },
);

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
