import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = join(__dirname, 'disk');

// The eager creation build must not clobber the resolved reporter config: a
// caller inspecting `context` before any run should still see the reporters it
// configured, not an empty list.
const rstest = await createRstest({
  cwd,
  config: {
    include: ['sum.test.ts'],
    reporters: ['dot'],
  },
});

const rootReporters = rstest.context.normalizedConfig.reporters;
const projectReporters =
  rstest.context.projects?.[0]?.normalizedConfig?.reporters;

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    command: rstest.context.command,
    rootReporters,
    projectReporters,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
