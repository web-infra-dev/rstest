import { defineConfig } from '@rstest/core';

// The preset contributes a setupFiles entry. `loadConfig` already resolves this
// `extends` on disk; the programmatic `config` factory then resolves the same
// object again — which must NOT re-apply the preset and duplicate setup.ts.
export default defineConfig({
  extends: {
    setupFiles: ['./setup.ts'],
  },
  include: ['setup-count.test.ts'],
  reporters: [],
});
