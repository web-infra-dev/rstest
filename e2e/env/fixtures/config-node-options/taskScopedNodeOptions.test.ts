import { expect, it } from '@rstest/core';

it('applies NODE_OPTIONS after worker spawn', () => {
  expect(process.env.NODE_OPTIONS).toBe('--not-a-real-node-option');
});
