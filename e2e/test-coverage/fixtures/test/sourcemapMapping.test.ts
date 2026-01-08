import { expect, test } from '@rstest/core';
// @ts-expect-error
import { Calculator, Status } from '../test-temp-sourcemap-dist/sourcemap.js';

test('calculator', () => {
  const calc = new Calculator(2);
  expect(calc.add(5)).toBe(20);
  expect(Status.Active).toBe('active');
});
