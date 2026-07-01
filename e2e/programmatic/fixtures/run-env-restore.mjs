import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// Simulate a host that never set these itself, so the API must not leave them
// behind after the instance is closed.
delete process.env.NODE_ENV;
delete process.env.RSTEST;

const snapshot = () => ({
  NODE_ENV: process.env.NODE_ENV ?? null,
  RSTEST: process.env.RSTEST ?? null,
});

const before = snapshot();

const rstest = await createRstest({
  cwd,
  config: {
    include: ['*.test.ts'],
    exclude: ['failing.test.ts'],
    reporters: [],
  },
});

// Instance is live: workers must observe test-mode env.
const during = snapshot();

const result = await rstest.run();
await rstest.close();

const after = snapshot();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    before,
    during,
    after,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
