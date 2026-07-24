import { defineConfig } from '@rstest/core';

// Disk config includes BOTH test files; the programmatic `config` callback
// receives this resolved object and narrows `include` to a single file.
export default defineConfig({
  include: ['a.test.ts', 'b.test.ts'],
  reporters: [],
});
