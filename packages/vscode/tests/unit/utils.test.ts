import { expect, it, rs } from '@rstest/core';
import { isTestFile } from '../../src/utils';

rs.mock('vscode', () => {
  return {};
});

it('test isTestFile', () => {
  expect(isTestFile('/path/to/file.test.js')).toBeTruthy();
  expect(isTestFile('/path/to/file.spec.tsx')).toBeTruthy();
  expect(isTestFile('/path/to/file.test.mjs')).toBeTruthy();
  expect(isTestFile('/path/to/file.spec.cjs')).toBeTruthy();
  // cspell:disable-next-line
  expect(isTestFile('/path/to/file.testmjs')).toBeFalsy();
  expect(isTestFile('/path/to/file.js')).toBeFalsy();
  expect(isTestFile('/path/to/testfile.txt')).toBeFalsy();
});
