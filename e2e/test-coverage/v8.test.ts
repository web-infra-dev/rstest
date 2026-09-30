import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { normalize } from 'pathe';
import { runRstestCli } from '../scripts';

const fixturePath = join(__dirname, 'fixtures');
const enableConfig = 'rstest.enable.v8.config.ts';

type FileCoverage = {
  path: string;
  s: Record<string, number>;
  f: Record<string, number>;
  b: Record<string, number[]>;
  statementMap: unknown;
};

describe('coverage v8-specific behavior', () => {
  it.for(['forks', 'vmThreads'] as const)(
    'writes bundle assets alongside raw V8 coverage under %s',
    async (pool, { onTestFinished }) => {
      const debugDirectory = join(fixturePath, '.rstest');
      const reportsDirectory = `test-temp-v8-${pool}`;
      const reportPath = join(fixturePath, reportsDirectory);
      const removeDebugOutput = () => fs.removeSync(debugDirectory);
      removeDebugOutput();
      onTestFinished(removeDebugOutput);
      onTestFinished(() => fs.removeSync(reportPath));

      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          enableConfig,
          '--pool',
          pool,
          ...(pool === 'vmThreads' ? ['--pool.memoryLimit', '256MB'] : []),
          '--coverage.reporters',
          'text-summary',
          '--coverage.reporters',
          'json',
          '--coverage.reportsDirectory',
          reportsDirectory,
        ],
        options: {
          nodeOptions: {
            cwd: fixturePath,
            env: { DEBUG: 'rstest:bundle-coverage' },
          },
        },
      });

      await expectExecSuccess();

      const files = fs
        .readdirSync(debugDirectory)
        .filter((file) => file.startsWith('bundle-coverage-'));
      expect(files).toHaveLength(1);

      const output = fs.readJsonSync(join(debugDirectory, files[0]!)) as {
        version: number;
        tests: {
          assets: Record<string, number>;
          rawV8: { entries: { filePath: string }[] };
        }[];
      };
      expect(output.version).toBe(1);
      expect(output.tests.length).toBeGreaterThan(0);

      for (const test of output.tests) {
        expect(Object.keys(test.assets).length).toBeGreaterThan(0);
        expect(test.rawV8.entries.length).toBeGreaterThan(0);
        expect(
          test.rawV8.entries.every((entry) => entry.filePath in test.assets),
        ).toBeTruthy();
      }

      const coverage = fs.readJsonSync(
        join(reportPath, 'coverage-final.json'),
      ) as Record<string, unknown>;
      expect(Object.keys(coverage).map(normalize)).toContainEqual(
        expect.stringMatching(/\/src\/index\.ts$/),
      );
    },
  );

  it('preserves the configured provider with --coverage', async ({
    onTestFinished,
  }) => {
    const reportsDirectory = 'test-temp-v8-cli-coverage';
    const reportPath = join(fixturePath, reportsDirectory);
    onTestFinished(() => fs.removeSync(reportPath));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--coverage',
        '-c',
        enableConfig,
        '--coverage.reportsDirectory',
        reportsDirectory,
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();
    expectLog('Coverage enabled with v8', cli.stdout.split('\n'));
  });

  it('keeps user sources under scoped @rstest folders', async ({
    onTestFinished,
  }) => {
    const scopedFixturePath = join(__dirname, 'fixtures-v8/scoped-source');
    onTestFinished(() => fs.removeSync(join(scopedFixturePath, 'coverage')));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      options: {
        nodeOptions: {
          cwd: scopedFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with v8', logs);
    expect(
      logs
        .find((log) => log.includes('index.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toBe('index.ts|100|100|100|100|');
  });

  it('matches project-relative include patterns in nested projects', async ({
    onTestFinished,
  }) => {
    const projectFixturePath = join(__dirname, 'fixtures-v8/multi-project');
    onTestFinished(() => fs.removeSync(join(projectFixturePath, 'coverage')));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      options: {
        nodeOptions: {
          cwd: projectFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with v8', logs);
    expect(
      logs
        .find((log) => log.includes('counter.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toBe('counter.ts|100|100|100|100|');
  });

  it('overrides the reports directory from CLI', async ({ onTestFinished }) => {
    const reportPath = join(fixturePath, 'cli-coverage');
    const defaultReportPath = join(fixturePath, 'coverage');
    onTestFinished(() => fs.removeSync(reportPath));
    fs.removeSync(defaultReportPath);

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        enableConfig,
        '--coverage.reporters',
        'json',
        '--coverage.reportsDirectory',
        'cli-coverage',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    expectLog('Coverage enabled with v8', cli.stdout.split('\n'));
    expect(fs.existsSync(join(reportPath, 'coverage-final.json'))).toBeTruthy();
    expect(fs.existsSync(defaultReportPath)).toBeFalsy();
  });

  it('overrides include and exclude patterns from CLI', async ({
    onTestFinished,
  }) => {
    const ignoredPackagePath = join(
      fixturePath,
      'node_modules/ignored-package',
    );
    const reportsDirectory = 'test-temp-v8-include-exclude-coverage';
    const reportPath = join(fixturePath, reportsDirectory);
    onTestFinished(() => {
      fs.removeSync(ignoredPackagePath);
      fs.removeSync(reportPath);
    });

    fs.outputFileSync(
      join(ignoredPackagePath, 'index.ts'),
      'export const ignored = () => "ignored";\n',
    );

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        enableConfig,
        '--coverage.reporters',
        'text',
        '--coverage.include',
        'src/**',
        '--coverage.exclude',
        '**/date.ts',
        '--coverage.reportsDirectory',
        reportsDirectory,
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with v8', logs);
    expect(
      logs.find((log) => log.includes('index.ts') && log.includes('|')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('date.ts') && log.includes('|')),
    ).toBeFalsy();
    expect(
      logs.find((log) => log.includes('ignored-package') && log.includes('|')),
    ).toBeFalsy();
  });

  it('overrides clean from CLI', async ({ onTestFinished }) => {
    const reportPath = join(fixturePath, 'coverage');
    const staleCoverageFile = join(reportPath, 'stale-coverage.json');
    onTestFinished(() => fs.removeSync(reportPath));
    fs.ensureFileSync(staleCoverageFile);

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        enableConfig,
        '--coverage.reporters',
        'json',
        '--coverage.clean=false',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    expectLog('Coverage enabled with v8', cli.stdout.split('\n'));
    expect(fs.existsSync(staleCoverageFile)).toBeTruthy();
    expect(fs.existsSync(join(reportPath, 'coverage-final.json'))).toBeTruthy();
  });

  it('overrides reporters from CLI', async ({ onTestFinished }) => {
    const reportPath = join(fixturePath, 'coverage');
    onTestFinished(() => fs.removeSync(reportPath));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        enableConfig,
        '--coverage.reporters',
        'text',
        '--coverage.reporters=json',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with v8', logs);
    expectLog('% Stmts', logs);
    expect(fs.existsSync(join(reportPath, 'coverage-final.json'))).toBeTruthy();
    expect(fs.existsSync(join(reportPath, 'index.html'))).toBeFalsy();
    expect(fs.existsSync(join(reportPath, 'clover.xml'))).toBeFalsy();
  });

  // `isolate: false` is the variant that proves the fix: b.test.ts then calls
  // the `classify` instance a.test.ts loaded, whose code lives in a.test.ts's
  // chunk. `isolate: true` is the reference.
  it.for([true, false])(
    'counts every test file of a worker with isolate: %s',
    async (isolate, { onTestFinished }) => {
      const sessionFixturePath = join(__dirname, 'fixtures-v8/worker-session');
      const reportsDirectory = `test-temp-isolate-${isolate}`;
      const reportPath = join(sessionFixturePath, reportsDirectory);
      // Without cached durations, files run by bundle size, so the largest,
      // profile.test.ts, runs first and a.test.ts / b.test.ts run after it
      // disabled the profiler.
      fs.removeSync(join(sessionFixturePath, 'node_modules/.cache'));
      onTestFinished(() => fs.removeSync(reportPath));

      const { expectExecSuccess, cli } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--isolate',
          String(isolate),
          '--reporter',
          'default',
          '--coverage.reportsDirectory',
          reportsDirectory,
        ],
        options: {
          nodeOptions: {
            cwd: sessionFixturePath,
          },
        },
      });

      await expectExecSuccess();

      const fileOrder = cli.stdout
        .split('\n')
        .map((line) => line.match(/test\/(\w+)\.test\.ts/)?.[1])
        .filter(Boolean);
      expect(fileOrder[0]).toBe('profile');

      const coverage = fs.readJsonSync(
        join(reportPath, 'coverage-final.json'),
      ) as Record<string, FileCoverage>;
      const classify = Object.entries(coverage).find(([file]) =>
        normalize(file).endsWith('/src/classify.ts'),
      )?.[1];
      // a.test.ts calls classify with 1, 2, 3 and b.test.ts with 4, 5.
      expect(Object.values(classify?.f ?? {})).toEqual([5]);
      expect(Object.values(classify?.s ?? {})).toEqual([5, 3, 2]);
      expect(Object.values(classify?.b ?? {})).toEqual([[3, 2]]);
    },
  );

  it('reports externalized CommonJS files the same in VM pools', async ({
    onTestFinished,
  }) => {
    const externalsFixturePath = join(__dirname, 'fixtures-v8/externals-cjs');
    const readCoverage = async (pool: 'forks' | 'vmThreads') => {
      const reportsDirectory = `test-temp-${pool}`;
      const reportPath = join(externalsFixturePath, reportsDirectory);
      onTestFinished(() => fs.removeSync(reportPath));
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--pool',
          pool,
          '--coverage.reportsDirectory',
          reportsDirectory,
        ],
        options: {
          nodeOptions: {
            cwd: externalsFixturePath,
          },
        },
      });
      await expectExecSuccess();
      const coverage = fs.readJsonSync(
        join(reportPath, 'coverage-final.json'),
      ) as Record<string, FileCoverage>;
      return Object.fromEntries(
        Object.values(coverage).map(({ path, s, f, b, statementMap }) => [
          normalize(path).split('/').pop(),
          { s, f, b, statementMap },
        ]),
      );
    };

    const forks = await readCoverage('forks');
    // The VM pools compile externalized CommonJS themselves; hashbang.cjs
    // starts with a hashbang and bom.cjs with a byte order mark.
    expect(await readCoverage('vmThreads')).toEqual(forks);
    expect(Object.values(forks['hashbang.cjs']!.f)).toEqual([3]);
    expect(Object.values(forks['bom.cjs']!.f)).toEqual([2]);
  });
});
