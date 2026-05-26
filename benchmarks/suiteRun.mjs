/**
 * CodSpeed benchmarks for focused rstest performance paths.
 *
 * Instead of one large mixed suite, we keep focused fixtures for compile,
 * runner, and a small end-to-end integration flow.
 *
 * Runs under CodSpeed CPU simulation (Callgrind) on `ubuntu-latest`. The
 * runner invokes Valgrind with `--instr-atstart=no` and the tinybench plugin
 * toggles instrumentation around each task via `callgrind_start_instrumentation`
 * — a process-wide Callgrind client request. Forked workers go through
 * `fork+execve`, which resets the new process's instrumentation state to the
 * CLI default (off); they never call the start hook, so their work would not
 * be measured. Each fixture therefore opts into `pool: 'threads'` so the whole
 * test pipeline stays in the bench process and counts toward the measurement.
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

// CodSpeed simulation mode injects V8 introspection flags (e.g.
// `--allow-natives-syntax`, `--predictable`, `--hash-seed=1`) into the parent
// process's CLI for deterministic Callgrind measurement. Those flags have
// already taken effect on the parent's V8 engine, but `node:worker_threads`
// rejects any execArgv entry outside its allow list, so propagating the
// parent's `process.execArgv` to the threads pool's Worker throws
// `Initiated Worker with invalid execArgv flags`. Clearing the snapshot is
// safe: parent determinism is preserved, and the bench fixtures don't need
// any inherited Node flags in their workers.
process.execArgv = [];

const { initCli, createRstest } = await import('@rstest/core');

const bench = withCodSpeed(
  new Bench({
    time: 0,
    iterations: 100,
    warmupTime: 0,
    warmupIterations: 5,
  }),
);

async function runFixture(fixtureName) {
  const { config, configFilePath, projects } = await initCli({
    root: resolve(fixturesRoot, fixtureName),
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
