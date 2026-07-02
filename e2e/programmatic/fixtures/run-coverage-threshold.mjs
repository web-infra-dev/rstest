import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'coverage-threshold');

const rstest = await createRstest({
  cwd,
  config: {
    include: ['*.test.ts'],
    reporters: [],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporters: [],
      // The single test covers only one branch, so a 100% threshold can never
      // be met — coverage fails while every test passes.
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
const result = await rstest.run();
await rstest.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    // close() restores the host exit code the coverage failure set during the run.
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
