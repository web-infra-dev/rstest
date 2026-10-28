import { expect, test } from '@rstest/core';
import './registration.js';
import './barrel.js';
import { answer } from './answer.js';
import { setupAnswer } from './setup-answer.js';
import { read } from './helper.js';
import { unused } from './unused.js';
import { state } from './state.js';

test('keeps direct test and setup initialization only', () => {
  expect(answer()).toBe('test mock');
  expect(setupAnswer()).toBe('setup mock');
  expect(state.setupRuns).toBe(1);
  expect(state.barrelRuns).toBe(1);
  expect(read()).toBe(42);
  expect(state.indirectRuns).toBe(0);
  expect(state.unusedRuns).toBe(0);
});
