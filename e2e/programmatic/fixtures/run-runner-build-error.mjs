import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Generated rather than committed: a file that cannot be parsed would fail the
// repo's own lint/typecheck passes. `test-temp-*` is gitignored and excluded
// from the e2e tsconfig.
const cwd = join(__dirname, 'test-temp-broken');
rmSync(cwd, { recursive: true, force: true });
mkdirSync(cwd, { recursive: true });
writeFileSync(
  join(cwd, 'broken.test.ts'),
  "import { it } from '@rstest/core';\n\nit('never compiles', () => {\n",
);

const rstest = await createRstest({
  cwd,
  config: { include: ['*.test.ts'], reporters: [] },
});

const messageOf = (promise) =>
  promise.then(
    () => null,
    (err) => (err instanceof Error ? err.message : String(err)),
  );

// Explicit build(): the caller asked to compile, so a compile error rejects.
const explicitRunner = await rstest.createRunner();
const buildError = await messageOf(explicitRunner.build());
await explicitRunner.close();

// Implicit build inside run(): the same failure is contained in the result, on
// a runner that has never built.
const implicitRunner = await rstest.createRunner();
const result = await implicitRunner.run();
await implicitRunner.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    buildError,
    ok: result.ok,
    unhandledErrors: result.unhandledErrors.map((err) => err.message),
    stats: result.stats,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
