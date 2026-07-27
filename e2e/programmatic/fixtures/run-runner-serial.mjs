import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'runner');

const rstest = await createRstest({
  cwd,
  config: { include: ['*.test.ts'], reporters: [] },
});
const runner = await rstest.createRunner();

const messageOf = (promise) =>
  promise.then(
    () => null,
    (err) => (err instanceof Error ? err.message : String(err)),
  );

// Start a run without awaiting it: overlapping calls are a caller bug, so they
// must reject rather than queue up behind it.
const inFlight = runner.run();
const concurrentRunError = await messageOf(runner.run());
const concurrentBuildError = await messageOf(runner.build());

const result = await inFlight;

// Both rejections are misuse, not run failures — the run itself still finishes
// normally, and a later run works.
const afterError = await runner.run();

await runner.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    concurrentRunError,
    concurrentBuildError,
    ok: result.ok,
    passed: result.stats.tests.passed,
    afterErrorOk: afterError.ok,
    afterErrorPassed: afterError.stats.tests.passed,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
