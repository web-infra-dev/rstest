import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// No port is reserved here on purpose: the guard must reject before any dev
// server or browser session is started, so this fixture needs no browser
// binary. If the guard regressed, the run would try to launch one and this
// fixture would fail instead of silently passing.
const rstest = await createRstest({
  cwd,
  config: {
    include: ['sum.test.ts'],
    reporters: [],
    browser: { enabled: true, provider: 'playwright', headless: true },
  },
});

let createRunnerError = null;
let hadRunner = false;
try {
  const runner = await rstest.createRunner();
  hadRunner = true;
  await runner.close();
} catch (err) {
  createRunnerError = err instanceof Error ? err.message : String(err);
}

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    createRunnerError,
    hadRunner,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
