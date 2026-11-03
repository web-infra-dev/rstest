import { expect, it } from '@rstest/core';
import { state } from './sequence-state';
import { value } from './sequence-target';

it('should run setup file correctly', () => {
  expect(process.env.RETEST_SETUP_FLAG).toBe('1');
  expect(process.env.NODE_ENV).toBe('rstest:production');
});

it('addSnapshotSerializer should works', () => {
  expect(__filename).toMatchInlineSnapshot(`"<WORKSPACE>/basic/index.test.ts"`);
});

if (process.env.SETUP_FAILURE) {
  console.log('TEST_COLLECTED_AFTER_FAILED_SETUP');
}
expect(state.firstFinished).toBe(true);
expect(state.secondFinished).toBe(true);

it('waits for setup files and shares their modules and mocks', () => {
  expect(state.overlap).toBe(process.env.SETUP_SEQUENCE === 'parallel');
  expect(value).toBe('mocked');
});
