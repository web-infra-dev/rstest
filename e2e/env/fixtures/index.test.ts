import { expect, it } from '@rstest/core';

it('should get environment variables correctly', () => {
  expect(process.env.printLogger).toBe('true');
});

it('should get environment variables correctly', () => {
  expect(process.env.aa).toBeTypeOf('undefined');
});
