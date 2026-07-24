import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// `createRunner()` rejects for browser mode, but the one-shot `run()` is
// rewritten on top of the same factory — so this asserts the sugar still routes
// browser projects through the one-shot orchestrator (build, run, tear down per
// call) instead of inheriting the runner's fail-fast.
const rstest = await createRstest({
  cwd,
  config: {
    include: ['sum.test.ts'],
    reporters: [],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      // Registered as `programmatic-runner` in browser-mode/fixtures/ports.ts;
      // this fixture is plain JS and cannot import that TS module.
      port: 5270,
    },
    testTimeout: 20_000,
  },
});

const result = await rstest.run();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    unhandledErrors: result.unhandledErrors.map((err) => err.message),
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
