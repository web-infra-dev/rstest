import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'runner-state');

// `isolate: false` with a single worker keeps user modules loaded across the
// files of one run, so both files observe the same module-level counter (1 then
// 2). Every `run()` must still start from a fresh runtime, so the second run
// has to observe 1 and 2 again rather than 3 and 4 — while staying in the same
// worker process, which is what makes it a *reset* runtime rather than a
// respawned pool.
const rstest = await createRstest({
  cwd,
  config: {
    include: ['*.test.ts'],
    reporters: [],
    isolate: false,
    pool: { maxWorkers: 1 },
  },
});
const runner = await rstest.createRunner();

const summarize = (result) => {
  const tests = result.files.flatMap((file) => file.results);
  return {
    ok: result.ok,
    counts: tests.map((test) => test.meta?.count).sort(),
    pids: Array.from(new Set(tests.map((test) => test.meta?.pid))),
  };
};

const first = await runner.run();
const second = await runner.run();

await runner.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    first: summarize(first),
    second: summarize(second),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
