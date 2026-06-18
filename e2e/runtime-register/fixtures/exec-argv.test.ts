import { rmSync } from 'node:fs';
import { expect, test } from '@rstest/core';

test('passes pool.execArgv node flags to workers', ({ onTestFinished }) => {
  const registerFlagPath = process.env.RUNTIME_REGISTER_FLAG_PATH;
  if (registerFlagPath) {
    onTestFinished(() => rmSync(registerFlagPath, { force: true }));
  }

  expect(process.execArgv).toContain('--conditions=rstest-e2e');
  expect(process.execArgv).toContain('--require');
  expect(process.execArgv).toContain('./cjs-register.cjs');
  expect(process.execArgv).toContain('--import');
  expect(process.execArgv).toContain('./register.mjs');
});
