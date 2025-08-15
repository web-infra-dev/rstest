import { expect, it } from '@rstest/core';

let count = 1;
it('should run success with retry', () => {
  expect(count++).toBe(5);
});
