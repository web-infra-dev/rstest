import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'runner-global-setup');

// `test-temp-*` is gitignored; recreate it per invocation so a previous run's
// log never counts.
const logFile = join(cwd, 'test-temp-global-setup.log');
rmSync(logFile, { force: true });
process.env.RSTEST_RUNNER_E2E_LOG = logFile;

const readLog = () => {
  try {
    return readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  } catch {
    // No log file means global setup never ran.
    return [];
  }
};

const rstest = await createRstest({
  cwd,
  config: {
    include: ['*.test.ts'],
    reporters: [],
    globalSetup: ['./globalSetup.ts'],
  },
});
const runner = await rstest.createRunner();

// globalSetup belongs to the runner, not to a run: three runs, one setup.
await runner.run();
const afterFirstRun = readLog();
await runner.run();
await runner.run();
const afterThirdRun = readLog();

await runner.close();
const afterClose = readLog();

// A failing teardown is the one failure a runner reports outside a run: it
// rejects close() rather than landing in the last run's result.
process.env.RSTEST_RUNNER_E2E_TEARDOWN_FAIL = '1';
const failingRunner = await rstest.createRunner();
const lastResultOk = (await failingRunner.run()).ok;
const closeError = await failingRunner.close().then(
  () => null,
  (err) => (err instanceof Error ? err.message : String(err)),
);

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    afterFirstRun,
    afterThirdRun,
    afterClose,
    lastResultOk,
    closeError,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
