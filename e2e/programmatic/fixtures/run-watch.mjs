import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

let runEnds = 0;
// Minimal reporter that just counts completed runs, so we can wait for the
// initial watch run without depending on (CI-flaky) file-change reruns.
const countingReporter = {
  onTestRunEnd() {
    runEnds += 1;
  },
};

const rstest = await createRstest({
  cwd,
  config: {
    include: ['*.test.ts'],
    exclude: ['failing.test.ts'],
    reporters: [countingReporter],
  },
});

const watcher = await rstest.watch();

const deadline = Date.now() + 20_000;
while (runEnds < 1) {
  if (Date.now() > deadline) {
    throw new Error('watch did not complete an initial run within 20s');
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const hasClose = typeof watcher.close === 'function';

// Tearing down must release the dev server + worker pool so this host process
// can exit cleanly (a leaked handle would hang the e2e runner).
await watcher.close();
await rstest.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    hasClose,
    ranAtLeastOnce: runEnds >= 1,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
