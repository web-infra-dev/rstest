import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// `onResult` fires on the initial run too, so a caller with no custom reporter
// still observes each run's structured result — including failures that would
// otherwise be swallowed. Include the failing file so we can assert the failure
// surfaces through `onResult` as a run()-parity TestRunResult.
let received;
const rstest = await createRstest({
  cwd,
  config: {
    include: ['*.test.ts'],
    reporters: [],
  },
});

const watcher = await rstest.watch({
  onResult: (result) => {
    received = result;
  },
});

const deadline = Date.now() + 20_000;
while (!received) {
  if (Date.now() > deadline) {
    throw new Error('onResult was not called within 20s');
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

await watcher.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: received.ok,
    stats: received.stats,
    unhandledErrorsCount: received.unhandledErrors.length,
    hasFiles: Array.isArray(received.files) && received.files.length > 0,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
