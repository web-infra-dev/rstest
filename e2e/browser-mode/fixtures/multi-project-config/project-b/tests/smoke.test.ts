import { expect, test } from '@rstest/core';
// Resolves only via project-b's `resolve.alias`. Fails to compile if project-b's
// files are built with another project's resolve config (issue #1473).
import { onlyB } from '@only-b';

test('smoke', () => {
  expect(1 + 1).toBe(2);
  expect(onlyB).toBe('b-value');
});
