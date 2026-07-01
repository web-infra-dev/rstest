import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// Simulate a host that never set these itself.
delete process.env.NODE_ENV;
delete process.env.RSTEST;

const snapshot = () => ({
  NODE_ENV: process.env.NODE_ENV ?? null,
  RSTEST: process.env.RSTEST ?? null,
});

const before = snapshot();

let threw = false;
try {
  // A throwing config callback fails the eager build before an instance (whose
  // close() restores the env) is ever returned.
  await createRstest({
    cwd,
    config: () => {
      throw new Error('boom');
    },
  });
} catch {
  threw = true;
}

const after = snapshot();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    threw,
    before,
    after,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
