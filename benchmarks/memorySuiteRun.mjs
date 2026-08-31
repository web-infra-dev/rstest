/**
 * CodSpeed memory benchmark for a generated large frontend workspace.
 *
 * Usage:
 *   pnpm --filter @rstest/benchmarks bench:memory
 */

import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { Bench } from 'tinybench';
import { createFrontendMemoryFixture } from './createFrontendMemoryFixture.mjs';

const { initCli, createRstest } = await import('@rstest/core');

const bench = withCodSpeed(
  new Bench({
    iterations: 1,
    time: 0,
    warmupIterations: 0,
    warmupTime: 0,
  }),
);

const pool = process.env.RSTEST_BENCH_MEMORY_POOL ?? 'forks';
if (pool !== 'forks' && pool !== 'vmThreads') {
  throw new Error(
    `RSTEST_BENCH_MEMORY_POOL must be "forks" or "vmThreads", received "${pool}".`,
  );
}
const maxWorkersValue = (process.env.RSTEST_BENCH_MEMORY_WORKERS ?? '4').trim();
const maxWorkers = Number(maxWorkersValue);
if (!/^[1-9]\d*$/.test(maxWorkersValue) || !Number.isSafeInteger(maxWorkers)) {
  throw new Error('RSTEST_BENCH_MEMORY_WORKERS must be a positive integer.');
}
const prebundle =
  process.env.RSTEST_BENCH_MEMORY_PREBUNDLE === 'auto' ? 'auto' : false;
const memoryLimit = process.env.RSTEST_BENCH_MEMORY_LIMIT ?? '256MB';
const fixture = await createFrontendMemoryFixture({
  maxWorkers,
  memoryLimit,
  pool,
  prebundle,
});

async function runSyntheticFrontendProject() {
  const { config, configFilePath, projects } = await initCli({
    reporter: [],
    root: fixture.root,
  });

  const rstest = createRstest({ config, configFilePath, projects }, 'run', []);
  await rstest.runTests();

  if (process.exitCode && process.exitCode !== 0) {
    throw new Error(
      `Synthetic frontend memory benchmark failed with exit code ${process.exitCode}`,
    );
  }

  process.exitCode = undefined;
}

bench.add('frontend-memory-full-run', async () => {
  const previousCacheDirectory = process.env.RSTEST_BENCH_MEMORY_CACHE;
  process.env.RSTEST_BENCH_MEMORY_CACHE = `${fixture.root}/.cache/run`;
  try {
    await runSyntheticFrontendProject();
  } finally {
    if (previousCacheDirectory === undefined) {
      delete process.env.RSTEST_BENCH_MEMORY_CACHE;
    } else {
      process.env.RSTEST_BENCH_MEMORY_CACHE = previousCacheDirectory;
    }
  }
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
      pool,
      prebundle,
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
