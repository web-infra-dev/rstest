import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'merge-reports');

// Fresh blob output dirs so reruns don't merge stale reports.
const FAIL_DIR = 'blobs-fail';
const PASS_DIR = 'blobs-pass';
for (const dir of [FAIL_DIR, PASS_DIR]) {
  rmSync(join(cwd, dir), { recursive: true, force: true });
}

// Produce a blob report for a run that contains a failing test.
const failRun = await createRstest({
  cwd,
  config: {
    include: ['fail.test.ts', 'pass.test.ts'],
    reporters: [['blob', { outputDir: FAIL_DIR }]],
  },
});
await failRun.run();

// Produce a blob report for an all-passing run.
const passRun = await createRstest({
  cwd,
  config: {
    include: ['pass.test.ts'],
    reporters: [['blob', { outputDir: PASS_DIR }]],
  },
});
await passRun.run();

// A merge instance only reads blobs; keep it quiet.
const merger = await createRstest({ cwd, config: { reporters: [] } });

// Failing blobs → resolves with ok=false and the failure surfaced as data.
const failMerge = await merger.mergeReports({ path: FAIL_DIR });

// Passing blobs → resolves with ok=true.
const passMerge = await merger.mergeReports({ path: PASS_DIR });

// Missing blob dir → rejects with the original core error.
let missingError = null;
try {
  await merger.mergeReports({ path: 'does-not-exist' });
} catch (err) {
  missingError = err instanceof Error ? err.message : String(err);
}

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    fail: {
      ok: failMerge.ok,
      failedTests: failMerge.stats.tests.failed,
      failedFiles: failMerge.stats.files.failed,
      hasFileDetail: failMerge.files.some((f) => f.status === 'fail'),
    },
    pass: {
      ok: passMerge.ok,
      passedTests: passMerge.stats.tests.passed,
    },
    missingRejected: missingError !== null,
    missingError,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
