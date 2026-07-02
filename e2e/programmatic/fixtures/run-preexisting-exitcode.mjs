import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// The embedding host was already marked failed before the run — this must not
// bleed into the run's `ok`.
process.exitCode = 1;

const rstest = await createRstest({
  cwd,
  config: {
    include: ['sum.test.ts'],
    reporters: [],
  },
});
const result = await rstest.run();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    // The passing run leaves the host's pre-existing exit code untouched.
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
