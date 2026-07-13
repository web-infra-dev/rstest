import { expect, test } from '@rstest/core';

test('browser test under root moved by modifyRstestConfig', () => {
  expect(globalThis.document).toBeDefined();
});
