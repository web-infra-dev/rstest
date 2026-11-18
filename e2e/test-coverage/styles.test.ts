import { join } from 'node:path';
import { expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runBrowserCliWithCwd } from '../browser-mode/utils';
import { getCoverageSummaryEntry, runRstestCli } from '../scripts';

it.for(['forks', 'vmThreads', 'browser'] as const)(
  'excludes stylesheets from V8 reports under %s',
  async (runtime, { onTestFinished }) => {
    const fixturePath = join(__dirname, '../build/fixtures/cssModules');
    const reportsDirectory = `test-temp-css-coverage-${runtime}`;
    onTestFinished(() => fs.removeSync(join(fixturePath, reportsDirectory)));
    const args = [
      ...(runtime === 'browser'
        ? ['--browser', '--browser.headless']
        : ['--pool', runtime]),
      '--coverage',
      '--coverage.provider',
      'v8',
      '--coverage.reporters',
      'json',
      '--coverage.reportsDirectory',
      reportsDirectory,
    ];
    const { expectExecSuccess } =
      runtime === 'browser'
        ? await runBrowserCliWithCwd(fixturePath, { args })
        : await runRstestCli({
            command: 'rstest',
            args: ['run', ...args],
            options: { nodeOptions: { cwd: fixturePath } },
          });
    await expectExecSuccess();

    const report: Record<string, unknown> = fs.readJsonSync(
      join(fixturePath, reportsDirectory, 'coverage-final.json'),
    );
    expect(
      Object.keys(report).some((file) => /\.css(?:$|[?#])/i.test(file)),
    ).toBe(false);
    expect(
      getCoverageSummaryEntry(report, join(fixturePath, 'src/index.ts')),
    ).toBeDefined();
  },
);
