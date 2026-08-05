import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/fixtures/summaryTruncation.test.ts'],
  reporters: [
    [
      'github-actions',
      {
        summary: {
          maxCharsPerField: 10_000,
        },
      },
    ],
  ],
});
