import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describe,
  expect,
  it,
  type onTestFinished as OnTestFinished,
} from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, './fixtures');
const cacheDir = join(fixtures, 'node_modules/.cache/.rstest-sequence');

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
) =>
  runRstestCli({
    command: 'rstest',
    args: ['run', '--pool.maxWorkers', '1'],
    onTestFinished,
    options: {
      nodeOptions: {
        cwd: fixtures,
        ...(env ? { env } : {}),
      },
    },
  });

describe('perf-first test sequencing', () => {
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
});
