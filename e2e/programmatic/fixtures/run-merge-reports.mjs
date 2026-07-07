import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// Produce blob reports for a run, then merge them back. `outputDir` keeps the
// failing and passing blobs in separate directories so the two merges don't
// read each other's reports.
const produceAndMerge = async (include, outputDir) => {
  const producer = await createRstest({
    cwd,
    config: {
      include,
      reporters: [['blob', { outputDir }]],
    },
  });
  await producer.run();

  const merger = await createRstest({
    cwd,
    config: { reporters: [] },
  });
  return merger.mergeReports({ path: outputDir, cleanup: true });
};

// Failing blobs → ok=false (the merge sees the failed test).
const failing = await produceAndMerge(
  ['sum.test.ts', 'failing.test.ts'],
  '.rstest-reports-fail',
);

// Passing blobs → ok=true.
const passing = await produceAndMerge(['sum.test.ts'], '.rstest-reports-pass');

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    failingOk: failing.ok,
    passingOk: passing.ok,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
