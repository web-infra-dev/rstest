import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describe,
  expect,
  it,
  type onTestFinished as OnTestFinished,
  type TestFileResult,
} from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, './fixtures');
const cacheDir = join(fixtures, 'node_modules/.cache/.rstest-results');

// With `--pool.maxWorkers 1` files run strictly one at a time, so the order of
// the per-file `SEQ:<name>` console markers in stdout is the execution order.
const seqOrder = (stdout: string): string[] => {
  const order: string[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(/SEQ:(alpha|beta|gamma)/);
    if (match && !order.includes(match[1]!)) {
      order.push(match[1]!);
    }
  }
  return order;
};

const runOnce = async (
  onTestFinished: typeof OnTestFinished,
  env?: Record<string, string>,
  extraArgs: string[] = [],
) =>
  runRstestCli({
    command: 'rstest',
    args: ['run', '--pool.maxWorkers', '1', ...extraArgs],
    onTestFinished,
    options: {
      nodeOptions: {
        cwd: fixtures,
        ...(env ? { env } : {}),
      },
    },
  });

describe('perf-first test sequencing', () => {
  for (const pool of ['forks', 'threads', 'vmForks', 'vmThreads']) {
    it(`includes module evaluation in warm ordering with ${pool}`, async ({
      onTestFinished,
    }) => {
      rmSync(cacheDir, { recursive: true, force: true });
      const env = { SEQ_SLOW_IMPORT: '1' };
      const args = [
        '--pool.type',
        pool,
        '--trace',
        '--config',
        join(fixtures, 'rstest.timing.config.mts'),
      ];
      await (await runOnce(onTestFinished, env, args)).expectExecSuccess();
      const warm = await runOnce(onTestFinished, env, args);
      await warm.expectExecSuccess();
      expect(seqOrder(warm.cli.stdout)[0]).toBe('beta');
      const timings: TestFileResult[] = warm.cli.stdout
        .split('\n')
        .filter((line) => line.startsWith('TIMING:'))
        .map((line) => JSON.parse(line.slice('TIMING:'.length)));
      const beta = timings.find((result) =>
        result.testPath.endsWith('beta.test.ts'),
      )!;
      expect(beta.loadDuration).toBeGreaterThanOrEqual(1200);
      expect(beta.duration).toBeLessThan(beta.loadDuration!);
      const tracePath = warm.cli.stdout.match(
        /Perfetto trace file:\s*(.*\.json)/,
      )?.[1];
      expect(tracePath).toBeTruthy();
      const trace: { traceEvents: NonNullable<TestFileResult['traceEvents']> } =
        JSON.parse(readFileSync(tracePath!, 'utf-8'));
      const loading = trace.traceEvents.filter(
        (event) =>
          event.name === 'file:load' && event.args?.testPath === beta.testPath,
      );
      expect(loading).toHaveLength(1);
      expect(loading[0]).toMatchObject({
        cat: 'file',
        ph: 'X',
        dur: beta.loadDuration! * 1000,
      });
      const details = trace.traceEvents.filter(
        (event) =>
          event.cat === 'phase' &&
          event.args?.testPath === beta.testPath &&
          ['load', 'setupFiles', 'collect'].includes(event.name),
      );
      expect(details.map((event) => event.name)).toEqual([
        'load',
        'setupFiles',
        'collect',
      ]);
      for (const event of details) {
        expect(event.ts).toBeGreaterThanOrEqual(loading[0]!.ts);
        expect(event.ts + event.dur!).toBeLessThanOrEqual(
          loading[0]!.ts + loading[0]!.dur!,
        );
      }
    }, 90_000);
  }

  it('reports loading time when module evaluation fails', async ({
    onTestFinished,
  }) => {
    const failed = await runOnce(
      onTestFinished,
      { SEQ_SLOW_IMPORT: '1', SEQ_IMPORT_FAIL: '1' },
      ['--trace', '--config', join(fixtures, 'rstest.timing.config.mts')],
    );
    await failed.expectExecFailed();
    const timings: TestFileResult[] = failed.cli.stdout
      .split('\n')
      .filter((line) => line.startsWith('TIMING:'))
      .map((line) => JSON.parse(line.slice('TIMING:'.length)));
    const beta = timings.find((result) =>
      result.testPath.endsWith('beta.test.ts'),
    )!;
    expect(beta.status).toBe('fail');
    expect(beta.loadDuration).toBeGreaterThanOrEqual(1200);
    expect(beta.duration).toBeUndefined();
    const tracePath = failed.cli.stdout.match(
      /Perfetto trace file:\s*(.*\.json)/,
    )?.[1];
    expect(tracePath).toBeTruthy();
    const trace: { traceEvents: NonNullable<TestFileResult['traceEvents']> } =
      JSON.parse(readFileSync(tracePath!, 'utf-8'));
    const loading = trace.traceEvents.filter(
      (event) =>
        event.name === 'file:load' && event.args?.testPath === beta.testPath,
    );
    expect(loading).toHaveLength(1);
    expect(loading[0]?.dur).toBe(beta.loadDuration! * 1000);
  });

  it('orders by bundle size (cold), then duration, then failed-first', async ({
    onTestFinished,
  }) => {
    // Start from a genuine cold cache.
    rmSync(cacheDir, { recursive: true, force: true });

    // 1. Cold start: no cached durations, so the largest bundle (beta, which
    //    imports the big helper) runs first — ahead of alphabetically-earlier
    //    'alpha'. This is the size-desc branch.
    const cold = await runOnce(onTestFinished);
    await cold.expectExecSuccess();
    expect(seqOrder(cold.cli.stdout)[0]).toBe('beta');

    // 2. Warm cache: gamma is the slowest file, so duration-desc (LPT) now
    //    puts it first, overriding the cold size order.
    const warm = await runOnce(onTestFinished);
    await warm.expectExecSuccess();
    expect(seqOrder(warm.cli.stdout)[0]).toBe('gamma');

    // 3a. Force alpha to fail so it is recorded as last-failed.
    const failing = await runOnce(onTestFinished, { SEQ_FAIL: '1' });
    await failing.expectExecFailed();

    // 3b. Next run: the previously-failed alpha jumps to the very front,
    //     ahead of the still-slow gamma (failed-first beats duration).
    const recovered = await runOnce(onTestFinished);
    await recovered.expectExecSuccess();
    expect(seqOrder(recovered.cli.stdout)[0]).toBe('alpha');
  }, 90_000);

  it('does not update the cache for a testNamePattern-filtered run', async ({
    onTestFinished,
  }) => {
    rmSync(cacheDir, { recursive: true, force: true });
    // Two full runs so every file has a real cached duration/fail state.
    await (await runOnce(onTestFinished)).expectExecSuccess();
    await (await runOnce(onTestFinished)).expectExecSuccess();
    const cacheFile = join(cacheDir, 'results.json');
    const before = readFileSync(cacheFile, 'utf-8');

    // `-t gamma` runs only gamma's test; alpha/beta are fully skipped. That
    // partial run must NOT overwrite the full-run cache — otherwise a quick
    // filtered run would make slow files look fast and drop failed-first bits.
    const filtered = await runOnce(onTestFinished, undefined, [
      '--testNamePattern',
      'gamma',
    ]);
    await filtered.expectExecSuccess();

    expect(readFileSync(cacheFile, 'utf-8')).toBe(before);
  }, 90_000);

  it('does not update the cache for a bail-aborted run', async ({
    onTestFinished,
  }) => {
    rmSync(cacheDir, { recursive: true, force: true });
    // Record alpha as failed so it becomes failed-first and runs first next time.
    await (await runOnce(onTestFinished, { SEQ_FAIL: '1' })).expectExecFailed();
    const cacheFile = join(cacheDir, 'results.json');
    const before = readFileSync(cacheFile, 'utf-8');

    // `--bail 1` with alpha (now failed-first) failing again: the pool aborts
    // and hands back the remaining files as synthetic `skip`s. Writing those
    // back would clear their failed-first bit, so the cache must stay untouched.
    const bailed = await runOnce(onTestFinished, { SEQ_FAIL: '1' }, [
      '--bail',
      '1',
    ]);
    await bailed.expectExecFailed();

    expect(readFileSync(cacheFile, 'utf-8')).toBe(before);
  }, 90_000);
});
