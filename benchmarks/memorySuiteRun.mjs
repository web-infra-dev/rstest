/**
 * CodSpeed memory benchmark for a generated large frontend workspace.
 *
 * Usage:
 *   pnpm --filter @rstest/benchmarks bench:memory
 */

import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { Bench } from 'tinybench';
import { createFrontendMemoryFixture } from './createFrontendMemoryFixture.mjs';

const { runCli } = await import('@rstest/core/api');

const bench = withCodSpeed(
  new Bench({
    iterations: 1,
    time: 0,
    warmupIterations: 0,
    warmupTime: 0,
  }),
);

const fixture = await createFrontendMemoryFixture();

async function runSyntheticFrontendProject() {
  // `runCli` is host-safe: it resolves a structured result instead of setting
  // `process.exitCode`, so no per-iteration exit-code reset is needed.
  const result = await runCli({
    reporters: [],
    root: fixture.root,
  });

  if (!result.ok) {
    throw new Error('Synthetic frontend memory benchmark failed');
  }
}

bench.add('frontend-memory-full-run', async () => {
  await runSyntheticFrontendProject();
});

try {
  await bench.run();
} finally {
  await fixture.cleanup();
}

const failedTask = bench.tasks.find((task) => task.result?.error);

if (failedTask?.result?.error) {
  throw failedTask.result.error;
}

if (!process.env.CODSPEED_ENV) {
  console.table(
    bench.tasks.map((task) => ({
      name: task.name,
      'avg (ms)': Number((task.result?.latency?.mean ?? 0).toFixed(2)),
      iterations: task.result?.latency?.samplesCount ?? 0,
    })),
  );

  console.log('');
  console.log(
    'Local note: this command only validates the workload and shows tinybench timing.',
  );
  console.log(
    'CodSpeed memory metrics are collected in CI on Linux through .github/workflows/codspeed.yml.',
  );
  console.log(
    'This benchmark intentionally uses a single iteration because the memory instrument tracks one full benchmark execution.',
  );
}
