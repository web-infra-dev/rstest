import { expect, test } from '@rstest/core';
import { value } from './src/value';

test('reused worker', () => {
  expect(value).toBe(2);
});
