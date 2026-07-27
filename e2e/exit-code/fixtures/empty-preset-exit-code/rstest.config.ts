import type { Reporter } from '@rstest/core';
import { defineConfig } from '@rstest/core';

// A reporter instance is constructed at config load in the main process, so its
// constructor deterministically pre-sets a non-zero exit code before `runTests`
// begins. With `passWithNoTests` the empty run resolves to code 0, and the
// never-downgrade policy in `reportNoTestFiles` must NOT clear the pre-set 42.
class PresetExitCodeReporter implements Reporter {
  constructor() {
    process.exitCode = 42;
  }
}

export default defineConfig({
  reporters: [new PresetExitCodeReporter()],
  passWithNoTests: true,
  // Intentionally points to a non-existing directory to exercise the empty-run
  // finalize path (no test files on either side).
  include: ['tests/**/*.test.ts'],
});
