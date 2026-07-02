import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCLI } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'related');

// Jest-compatible parsed-argv entry: positional source files live in `_`, and
// `related` reinterprets them as source files to resolve related tests from.
const result = await runCLI({ _: ['src/math.ts'], related: true }, { cwd });

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
