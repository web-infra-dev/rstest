import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// Simulate a host that never set these itself, and that had already marked
// itself failed before the runner existed.
delete process.env.NODE_ENV;
delete process.env.RSTEST;
process.exitCode = 3;

const snapshot = () => ({
  NODE_ENV: process.env.NODE_ENV ?? null,
  RSTEST: process.env.RSTEST ?? null,
});

const before = snapshot();

const rstest = await createRstest({
  cwd,
  // sum.test.ts passes, failing.test.ts fails: the run reports that on
  // its result, never on the host's exit code.
  config: { include: ['*.test.ts'], reporters: [] },
});
const runner = await rstest.createRunner();

const result = await runner.run();
// A live runner leaves the host exactly as it found it, including the exit code
// the host had set for its own reasons — there is nothing for close() to undo.
const duringRunner = { env: snapshot(), exitCode: process.exitCode ?? 0 };

await runner.close();
// Idempotent: a second close resolves without redoing teardown.
await runner.close();

const after = snapshot();

const closedRunError = await runner.run().then(
  () => null,
  (err) => (err instanceof Error ? err.message : String(err)),
);

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    failedTests: result.stats.tests.failed,
    before,
    duringRunner,
    after,
    closedRunError,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
