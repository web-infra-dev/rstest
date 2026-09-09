import { expect, test } from '@rstest/core';

test('does not inherit project A global APIs or console', () => {
  console.log('PROJECT_B_RAW_LOG');
  expect(Reflect.has(globalThis, 'test')).toBe(false);
  expect(Reflect.has(globalThis, 'expect')).toBe(false);
});
