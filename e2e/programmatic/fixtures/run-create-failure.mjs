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
  // A throwing config factory fails the eager build; construction must still
  // restore the host env it touched, even though no instance is returned.
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
