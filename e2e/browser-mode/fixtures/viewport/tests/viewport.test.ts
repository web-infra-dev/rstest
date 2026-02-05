import { expect, test } from '@rstest/core';

test('should apply configured viewport to runner iframe', () => {
  expect(window.innerWidth).toBe(390);
  expect(window.innerHeight).toBe(844);
});
