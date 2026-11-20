import { existsSync } from 'node:fs';
import { expect, it } from '@rstest/core';
import { checkFallback, fastStarted, slowBuilt } from './markers';

it('runs after its build finishes', () => {
  expect(existsSync(slowBuilt)).toBe(true);
  if (!checkFallback) expect(existsSync(fastStarted)).toBe(true);
});
