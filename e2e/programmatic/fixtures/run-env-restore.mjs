import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// Simulate a host that never set these itself, so the API must never leave them
// behind — neither at construction nor after a run.
delete process.env.NODE_ENV;
delete process.env.RSTEST;

const snapshot = () => ({
  NODE_ENV: process.env.NODE_ENV ?? null,
  RSTEST: process.env.RSTEST ?? null,
});

const before = snapshot();

const rstest = await createRstest({
  cwd,
  config: {
    include: ['*.test.ts'],
    exclude: ['failing.test.ts'],
    reporters: [],
  },
});

// Construction is host-safe: creating an instance must not leave the host in
// test mode (workers only spawn per run, with their own contained env).
const afterCreate = snapshot();

const result = await rstest.run();

// run() snapshots and restores process globals, so the host env is back the way
// it found it once the run resolves.
const afterRun = snapshot();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    before,
    afterCreate,
    afterRun,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
