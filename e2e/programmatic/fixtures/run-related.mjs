import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'related');

// findRelatedTests parity via the programmatic instance: positional `filters`
// are the changed source files, and `related` reinterprets them so only the
// tests that import them run. Only `math.test.ts` depends on `src/math.ts`.
const rstest = await createRstest({
  cwd,
  config: { include: ['**/*.test.ts'], reporters: [] },
});
const result = await rstest.run({ filters: ['src/math.ts'], related: true });

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    files: result.files
      .map((f) => ({
        status: f.status,
        // strip absolute path so the assertion is stable across machines
        testPath: f.testPath.split('/').pop(),
      }))
      .sort((a, b) => a.testPath.localeCompare(b.testPath)),
    // The API must not poison the host process exit code.
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
