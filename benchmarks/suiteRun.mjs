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

const { initCli, createRstest } = await import('@rstest/core');

const benchmarkOptions = {
  reporter: [],
};

const bench = withCodSpeed(
  new Bench({
    // Allow generous time — each task runs the full rstest pipeline.
    time: 0,
    iterations: 3,
    warmupTime: 0,
    warmupIterations: 0,
  }),
);

async function runFixture(fixtureName) {
  const { config, configFilePath, projects } = await initCli({
    root: resolve(fixturesRoot, fixtureName),
    ...benchmarkOptions,
  });

  const rstest = createRstest({ config, configFilePath, projects }, 'run', []);
  await rstest.runTests();

  if (process.exitCode && process.exitCode !== 0) {
    throw new Error(
      `CPU benchmark fixture "${fixtureName}" failed with exit code ${process.exitCode}`,
    );
  }

  // Reset process.exitCode between iterations because runTests() uses it to
  // signal failures to the CLI.
  process.exitCode = undefined;
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
      'avg (ms)': Number((t.result?.mean ?? 0).toFixed(2)),
      'p99 (ms)': Number((t.result?.p99 ?? 0).toFixed(2)),
      iterations: t.result?.samples?.length ?? 0,
    })),
  );
}
