import { expect, test } from '@rstest/core';
import { value } from './barrel.js';
import { answer } from './answer.js';
import { state } from './state.js';

test('still skips the barrel in a different test', () => {
  expect(value).toBe(42);
  expect(answer()).toBe('real');
  expect(state.barrelRuns).toBe(0);
});
