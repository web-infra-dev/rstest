import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

const rstest = await createRstest({
  cwd,
  config: { include: ['*.test.ts'], reporters: [] },
});
const runner = await rstest.createRunner();

// One runner, one context, one exit-code carrier: run the failing file first, so
// the second run only reports `ok: true` if the code was reset per cycle.
const failing = await runner.run({ filters: ['failing.test.ts'] });
const passing = await runner.run({ filters: ['sum.test.ts'] });
// Re-running the failure proves the reset restores a real code, not a
// permanently cleared one.
const failingAgain = await runner.run({ filters: ['failing.test.ts'] });

await runner.close();

const summarize = (result) => ({
  ok: result.ok,
  passed: result.stats.tests.passed,
  failed: result.stats.tests.failed,
});

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    failing: summarize(failing),
    passing: summarize(passing),
    failingAgain: summarize(failingAgain),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
