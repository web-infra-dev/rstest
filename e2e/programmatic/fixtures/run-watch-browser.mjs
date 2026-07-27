import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// Browser-mode watch isn't supported programmatically yet: watch() must reject
// fast (before starting the dev server / pool) rather than return a dead handle
// that leaks the browser session.
const rstest = await createRstest({
  cwd,
  config: {
    include: ['sum.test.ts'],
    reporters: [],
    browser: { enabled: true },
  },
});

let message = null;
let hadWatcher = false;
try {
  const watcher = await rstest.watch();
  hadWatcher = true;
  await watcher.close();
} catch (err) {
  message = err instanceof Error ? err.message : String(err);
}

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    message,
    hadWatcher,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
