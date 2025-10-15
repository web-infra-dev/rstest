import { expect, it } from '@rstest/core';

it('should get environment variables correctly', () => {
  expect(process.env.printLogger).toBe('true');
});
