import { rs, rstest } from '@rstest/core';

(globalThis as Record<string, unknown>).jest = rstest;

// Mocked in setup so test files can prove that `rs.unmock` cancels a mock
// registered earlier in the module graph (mirrors e2e/mock/fixtures/unmock).
rs.mock('./src/unmockTarget', () => {
  return {
    flag: 'mocked',
  };
});
