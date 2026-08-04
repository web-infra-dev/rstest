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
const projectNames = rstest.context.projects.map((project) => project.name);

// `context` is a plain projection of the internal engine context, so it must be
// structured-clonable. The raw engine object would throw a DataCloneError on its
// reporter functions / manager instances — this is the observable contract of
// the projection.
let cloneOk = false;
try {
  structuredClone(rstest.context);
  cloneOk = true;
} catch {
  // cloneOk stays false
}

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    rootReporters,
    projectNames,
    cloneOk,
    hostExitCode: process.exitCode ?? 0,
  })}__END__`,
);
