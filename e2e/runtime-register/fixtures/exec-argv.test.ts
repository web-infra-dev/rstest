import { expect, test } from '@rstest/core';

test('passes pool.execArgv node flags to workers', () => {
  expect(process.execArgv).toContain('--conditions=rstest-e2e');
  expect(process.execArgv).toContain('--require');
  expect(process.execArgv).toContain('./cjs-register.cjs');
  expect(process.execArgv).toContain('--import');
  expect(process.execArgv).toContain('./register.mjs');
});
