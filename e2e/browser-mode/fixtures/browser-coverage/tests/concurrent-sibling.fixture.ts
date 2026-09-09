import { expect, it } from '@rstest/core';
import { readConcurrentValue } from '../src/concurrent';

it('executes project code before its sibling fails', async () => {
  expect(readConcurrentValue()).toBe(42);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
});
