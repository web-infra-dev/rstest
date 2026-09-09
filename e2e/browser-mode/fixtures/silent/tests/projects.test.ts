import { expect, it } from '@rstest/core';

it('uses the project silent config', () => {
  console.log(`console from ${import.meta.env.RSTEST_E2E_SILENT_PROJECT}`);
  expect(1 + 1).toBe(2);
});
