/**
 * CodSpeed benchmarks for focused rstest performance paths.
 *
 * Instead of one large mixed suite, we keep focused fixtures for compile,
 * runner, and a small end-to-end integration flow.
 *
 * Usage:
 *   pnpm --filter @rstest/benchmarks bench:cpu
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { Bench } from 'tinybench';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(__dirname, 'fixtures');

const { runCli } = await import('@rstest/core/api');

const benchmarkOptions = {
  reporters: [],
};

const bench = withCodSpeed(
  new Bench({
    time: 0,
    iterations: 100,
    warmupTime: 0,
    warmupIterations: 5,
  }),
);

async function runFixture(fixtureName) {
  // `runCli` is host-safe: it resolves a structured result instead of setting
  // `process.exitCode`, so no per-iteration exit-code reset is needed.
  const result = await runCli({
    root: resolve(fixturesRoot, fixtureName),
    ...benchmarkOptions,
  });

  if (!result.ok) {
    throw new Error(`CPU benchmark fixture "${fixtureName}" failed`);
  }
}

bench.add('compile', async () => {
  await runFixture('compile');
});

bench.add('runner', async () => {
  await runFixture('runner');
});

bench.add('integration', async () => {
  await runFixture('integration');
});

await bench.run();

const failedTask = bench.tasks.find((task) => task.result?.error);

if (failedTask?.result?.error) {
  throw failedTask.result.error;
}

// Print a summary table when running locally (not in CodSpeed simulation).
if (!process.env.CODSPEED_ENV) {
  console.table(
    bench.tasks.map((t) => ({
      name: t.name,
      'avg (ms)': Number((t.result?.latency?.mean ?? 0).toFixed(2)),
      'p99 (ms)': Number((t.result?.latency?.p99 ?? 0).toFixed(2)),
      iterations: t.result?.latency?.samplesCount ?? 0,
    })),
  );
}
