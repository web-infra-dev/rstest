import { expect, it } from '@rstest/core';

it('browser side passes', () => {
  expect(typeof document).toBe('object');
});
