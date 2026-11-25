/**
 * CodSpeed CPU benchmarks (walltime mode) for focused Rstest performance paths:
 * - startup: full cold start (loadConfig + createRstest + minimal run)
 * - compile: cold multi-entry TS/TSX module graph compilation
 * - runner: high-density suite/hooks/mock/matcher execution with warm buildCache
 * - jsdom: jsdom (prebundle: 'auto') + React DOM client rendering + module mocking
 *
 * Usage:
 *   pnpm --filter @rstest/benchmarks bench:cpu
 */

import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { Bench } from 'tinybench';
import { createCpuFixtures } from './createCpuFixtures.mjs';

const { loadConfig, mergeRstestConfig } = await import('@rstest/core');
const { createRstest } = await import('@rstest/core/api');

function readNonNegativeInt(envName, fallback) {
  const raw = process.env[envName];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${envName} must be a non-negative integer.`);
  }
  return value;
}

const iterations = readNonNegativeInt('RSTEST_BENCH_CPU_ITERATIONS', 15);
const warmupIterations = readNonNegativeInt('RSTEST_BENCH_CPU_WARMUP', 3);

const bench = withCodSpeed(
  new Bench({
    time: 0,
    iterations,
    warmupTime: 0,
    warmupIterations,
  }),
);

async function assertRunPassed(name, result) {
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
      `CPU benchmark "${name}" failed (status=${result.status}, summary=${JSON.stringify(result.summary)})${details ? `: ${details}` : ''}`,
    );
  }
}

async function runWithConfig(name, cwd, config) {
  const rstest = await createRstest({ cwd, config });
  const result = await rstest.run();
  await assertRunPassed(name, result);
}

const fixtures = await createCpuFixtures();

try {
  // Preload configs for focused workloads so config compilation is isolated to `startup`.
  const [compileLoaded, runnerLoaded, jsdomLoaded] = await Promise.all([
    loadConfig({ cwd: fixtures.roots.compile }),
    loadConfig({ cwd: fixtures.roots.runner }),
    loadConfig({ cwd: fixtures.roots.jsdom }),
  ]);

  const compileConfig = mergeRstestConfig(compileLoaded.content, {
    reporters: [],
  });
  const runnerConfig = mergeRstestConfig(runnerLoaded.content, {
    reporters: [],
  });
  const jsdomConfig = mergeRstestConfig(jsdomLoaded.content, {
    reporters: [],
  });

  // Prime the runner fixture's buildCache once so the `runner` benchmark isolates
  // test collection, hooks, mocks, and assertions rather than compilation.
  await runWithConfig(
    'runner (cache prime)',
    fixtures.roots.runner,
    runnerConfig,
  );

  bench.add('startup', async () => {
    const { content } = await loadConfig({ cwd: fixtures.roots.startup });
    await runWithConfig(
      'startup',
      fixtures.roots.startup,
      mergeRstestConfig(content, { reporters: [] }),
    );
  });

  bench.add('compile', async () => {
    await runWithConfig('compile', fixtures.roots.compile, compileConfig);
  });

  bench.add('runner', async () => {
    await runWithConfig('runner', fixtures.roots.runner, runnerConfig);
  });

  bench.add('jsdom', async () => {
    await runWithConfig('jsdom', fixtures.roots.jsdom, jsdomConfig);
  });

  await bench.run();
} finally {
  await fixtures.cleanup();
}

const failedTask = bench.tasks.find((task) => task.result?.error);

if (failedTask?.result?.error) {
  throw failedTask.result.error;
}

// Print a summary table when running locally (not in CodSpeed runner).
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
