/**
 * CodSpeed memory benchmarks for a generated large frontend workspace
 * (jsdom + React DOM client mount/unmount + Ant Design + Three.js).
 *
 * By default runs both `forks` and `vmThreads` profiles using Rstest's default
 * `prebundle: 'auto'`. Set `RSTEST_BENCH_MEMORY_POOL=forks|vmThreads` to run a
 * single targeted profile locally.
 *
 * Usage:
 *   pnpm --filter @rstest/benchmarks bench:memory
 */

import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { Bench } from 'tinybench';
import {
  cleanupMemoryFixturesRoot,
  createFrontendMemoryFixture,
} from './createFrontendMemoryFixture.mjs';

const { loadConfig, mergeRstestConfig } = await import('@rstest/core');
const { createRstest } = await import('@rstest/core/api');

function parsePositiveInt(envName, fallback) {
  const raw = (process.env[envName] ?? String(fallback)).trim();
  const value = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value)) {
    throw new Error(`${envName} must be a positive integer.`);
  }
  return value;
}

const requestedPool = process.env.RSTEST_BENCH_MEMORY_POOL;
if (
  requestedPool !== undefined &&
  requestedPool !== 'forks' &&
  requestedPool !== 'vmThreads'
) {
  throw new Error(
    `RSTEST_BENCH_MEMORY_POOL must be "forks" or "vmThreads", received "${requestedPool}".`,
  );
}

const pools = requestedPool ? [requestedPool] : ['forks', 'vmThreads'];
const maxWorkers = parsePositiveInt('RSTEST_BENCH_MEMORY_WORKERS', 4);
const testFileCount = parsePositiveInt('RSTEST_BENCH_MEMORY_FILES', 36);
const prebundleEnv = process.env.RSTEST_BENCH_MEMORY_PREBUNDLE;
const prebundle =
  prebundleEnv === 'false' ? false : prebundleEnv === 'true' ? true : 'auto';
const memoryLimit = process.env.RSTEST_BENCH_MEMORY_LIMIT ?? '256MB';

const bench = withCodSpeed(
  new Bench({
    iterations: 1,
    time: 0,
    warmupIterations: 0,
    warmupTime: 0,
  }),
);

async function runProject(label, cwd, config) {
  const rstest = await createRstest({ cwd, config });
  const result = await rstest.run();

  if (result.status !== 'passed') {
    const failedFiles = (result.results ?? [])
      .filter((item) => item.status === 'failed')
      .slice(0, 3)
      .map(
        (item) =>
          `${item.testPath}: ${item.errors?.[0]?.message ?? 'file failed'}`,
      );
    const failedTests = (result.testResults ?? [])
      .filter((item) => item.status === 'failed')
      .slice(0, 3)
      .map(
        (item) => `${item.name}: ${item.errors?.[0]?.message ?? 'test failed'}`,
      );
    const unhandled = (result.unhandledErrors ?? []).map(
      (error) => error.message,
    );
    const details = [...unhandled, ...failedFiles, ...failedTests].join('; ');
    throw new Error(
      `Synthetic frontend memory benchmark "${label}" failed (status=${result.status})${details ? `: ${details}` : ''}`,
    );
  }
}

try {
  for (const pool of pools) {
    const fixture = await createFrontendMemoryFixture({
      maxWorkers,
      memoryLimit,
      pool,
      prebundle,
      testFileCount,
    });

    const { content } = await loadConfig({ cwd: fixture.root });
    const config = mergeRstestConfig(content, { reporters: [] });

    // Prime persistent buildCache once before benchmarking so local runs and
    // CodSpeed's analysis runner both measure warm-cache execution memory
    // consistently rather than mixing cold compilation into warmup #1 only.
    const taskName =
      pool === 'forks' ? 'frontend-memory-forks' : 'frontend-memory-vm-threads';

    await runProject(`${taskName} (cache prime)`, fixture.root, config);

    bench.add(taskName, async () => {
      await runProject(taskName, fixture.root, config);
    });
  }

  await bench.run();
} finally {
  await cleanupMemoryFixturesRoot();
}

const failedTask = bench.tasks.find((task) => task.result?.error);

if (failedTask?.result?.error) {
  throw failedTask.result.error;
}

if (!process.env.CODSPEED_ENV) {
  console.table(
    bench.tasks.map((task) => ({
      name: task.name,
      prebundle,
      files: testFileCount,
      workers: maxWorkers,
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
}
