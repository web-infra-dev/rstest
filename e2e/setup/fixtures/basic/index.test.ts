import { expect, it } from '@rstest/core';
import { value } from './value';

jest.mock('./value', () => ({ value: 'mocked' }));

it('should run setup file correctly', () => {
  expect(process.env.RETEST_SETUP_FLAG).toBe('1');
  expect(process.env.NODE_ENV).toBe('rstest:production');
});

it('addSnapshotSerializer should works', () => {
  expect(__filename).toMatchInlineSnapshot(`"<WORKSPACE>/basic/index.test.ts"`);
});

it('can expose rstest utilities under the Jest global', () => {
  const mock = jest.fn();

  mock('value');

  expect(mock).toHaveBeenCalledWith('value');
});

it('can mock modules through the Jest global', () => {
  expect(value).toBe('mocked');
});
