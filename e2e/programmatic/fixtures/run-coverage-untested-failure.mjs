import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Generated rather than committed: a file that cannot be parsed would fail the
// repo's own lint/typecheck passes. `test-temp-*` is gitignored and excluded
// from the e2e tsconfig.
const cwd = join(__dirname, 'test-temp-coverage-untested');
rmSync(cwd, { recursive: true, force: true });
mkdirSync(cwd, { recursive: true });
writeFileSync(
  join(cwd, 'covered.test.ts'),
  "import { expect, it } from '@rstest/core';\n\nit('passes', () => {\n  expect(1).toBe(1);\n});\n",
);
// Nothing imports this, so the compiler never sees it — it reaches the coverage
// provider only through the untested-file backfill, where instrumenting it
// throws. The provider swallows that error to still emit a partial report, so
// the only way the run can fail is the failure it reports back to core.
writeFileSync(join(cwd, 'untested.ts'), 'export const broken = (\n');

const rstest = await createRstest({
  cwd,
  config: {
    include: ['*.test.ts'],
    reporters: [],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporters: [],
      include: ['untested.ts'],
    },
  },
});
const result = await rstest.run();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    // The provider reported the failure as a value, so the host's exit code is
    // still the host's own.
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
