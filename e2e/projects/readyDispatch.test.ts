import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const cwd = fileURLToPath(
  new URL('./fixtures-ready-dispatch', import.meta.url),
);

it.for([
  { title: 'runs a ready project during another build' },
  { title: 'keeps results when a later project build fails', failBuild: true },
  { title: 'keeps the build barrier with bail', flag: '--bail' },
  {
    title: 'keeps the build barrier with failure selection',
    flag: '--onlyFailures',
  },
  {
    title: 'keeps the build barrier for a run-start reporter',
    reporter: true,
  },
])('$title', async ({ failBuild, flag, reporter }, { onTestFinished }) => {
  const temp = await mkdtemp(join(tmpdir(), 'rstest-ready-dispatch-'));
  onTestFinished(() => rm(temp, { force: true, recursive: true }));

  const { cli, expectExecSuccess, expectExecFailed } = await runRstestCli({
    command: 'rstest',
    args: flag ? ['run', flag] : ['run'],
    options: {
      nodeOptions: {
        cwd,
        env: {
          RSTEST_FAST_PROJECT_MARKER: join(temp, 'fast-started'),
          RSTEST_FAIL_SLOW_PROJECT: failBuild ? '1' : '0',
          RSTEST_CHECK_DISPATCH_FALLBACK: flag || reporter ? '1' : '0',
          RSTEST_CHECK_DISPATCH_REPORTER: reporter ? '1' : '0',
        },
      },
    },
    onTestFinished,
  });

  if (failBuild) {
    await expectExecFailed();
    expect(cli.stderr).toContain(
      'Slow project compilation failed after fast dispatch',
    );
    expect(cli.stdout).toMatch(/Tests\s+1 passed/);
  } else {
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests\s+2 passed/);
    if (reporter) expect(cli.stdout).toContain('Run-start selection verified');
  }
});

it('reports the last build and excludes build-only gaps from test time', async ({
  onTestFinished,
}) => {
  const temp = await mkdtemp(join(tmpdir(), 'rstest-ready-dispatch-timing-'));
  onTestFinished(() => rm(temp, { force: true, recursive: true }));
  const reportPath = join(temp, 'report.json');
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', '--trace'],
    options: {
      nodeOptions: {
        cwd,
        env: {
          RSTEST_FAST_PROJECT_MARKER: join(temp, 'fast-started'),
          RSTEST_DISPATCH_TIMING_REPORT: reportPath,
          RSTEST_FAIL_SLOW_PROJECT: '0',
          RSTEST_CHECK_DISPATCH_FALLBACK: '0',
          RSTEST_CHECK_DISPATCH_REPORTER: '0',
        },
      },
    },
    onTestFinished,
  });
  await cli.exec;
  const tracePath = cli.stdout.match(/Perfetto trace file:\s*(.*\.json)/)?.[1];
  if (tracePath) {
    onTestFinished(async () => {
      await rm(tracePath, { force: true });
      await rm(tracePath.replace(/\.json$/, '.summary.md'), { force: true });
    });
  }
  await expectExecSuccess();
  expect(tracePath).toBeTruthy();

  const { durationMs, summary } = JSON.parse(
    await readFile(reportPath, 'utf8'),
  );
  const { traceEvents } = JSON.parse(await readFile(tracePath!, 'utf8')) as {
    traceEvents: Array<{
      name: string;
      ts: number;
      dur: number;
      args?: { project?: string };
    }>;
  };
  const span = (name: string, project: string) => {
    const event = traceEvents.find(
      (event) => event.name === name && event.args?.project === project,
    );
    expect(event, `${name} for ${project}`).toBeDefined();
    return event!;
  };

  const slowBuild = span('host:get-rsbuild-stats', 'slow');
  const fastRun = span('host:pool-run-test', 'fast');
  const slowRun = span('host:pool-run-test', 'slow');
  const gapMs =
    (slowBuild.ts + slowBuild.dur - fastRun.ts - fastRun.dur) / 1000;
  const overlapMs = durationMs.build + durationMs.tests - durationMs.total;

  expect(summary.passedTests).toBe(2);
  expect(gapMs).toBeGreaterThan(0);
  expect(durationMs.build).toBeGreaterThanOrEqual(slowBuild.dur / 1000 - 1);
  expect(durationMs.total - durationMs.build).toBeGreaterThanOrEqual(
    slowRun.dur / 1000 - 2,
  );
  expect(overlapMs).toBeGreaterThanOrEqual(Math.max(0, fastRun.dur / 1000 - 2));
  // Allow for dispatch work outside the pool span while excluding the idle gap.
  expect(overlapMs).toBeLessThan(fastRun.dur / 1000 + gapMs / 2);
  expect(durationMs.total).toBeGreaterThanOrEqual(durationMs.build);
  expect(durationMs.total).toBeGreaterThanOrEqual(durationMs.tests);
});
