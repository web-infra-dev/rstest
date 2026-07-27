import type { Reporter } from '@rstest/core';
import { defineConfig } from '@rstest/core';

// A reporter instance lives in the main process for the whole run, so pinning a
// non-zero exit code in `onTestRunStart` deterministically pre-sets it before
// `finalizeRunCycle`. The never-downgrade policy must preserve it even when a
// test later fails (which would otherwise set the code to 1).
class PresetExitCodeReporter implements Reporter {
  onTestRunStart() {
    process.exitCode = 42;
  }
}

export default defineConfig({
  reporters: [new PresetExitCodeReporter()],
});
