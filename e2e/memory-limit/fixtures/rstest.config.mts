import { defineConfig } from '@rstest/core';

export default defineConfig({
  // `isolate: false` is the only mode where `memoryLimit` is consulted
  // — workers must be reused for the recycle decision to matter.
  isolate: false,
  // `memoryLimit: 2` parses as 2 bytes (values > 1 are bytes; values in
  // `(0, 1]` would be a fraction of total system memory). Every worker
  // is over-limit the instant it reports its first RSS sample, so the
  // pool must dispose it before reusing. The fixture then asserts each
  // test file ran in a distinct process, proving the cap was honored
  // end-to-end.
  pool: {
    maxWorkers: 1,
    memoryLimit: 2,
  },
});
