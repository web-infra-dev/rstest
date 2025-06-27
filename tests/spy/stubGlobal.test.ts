import { expect, it, rstest } from '@rstest/core';

declare global {
  var __test_flag__: boolean | undefined;
}

function checkGlobalThis() {
  expect(__test_flag__).toBeTruthy();
}

it('test stubGlobal & unstubAllGlobals', () => {
  const testFlag = '__test_flag__';
  expect(globalThis[testFlag]).toBeUndefined();

  rstest.stubGlobal(testFlag, true);

  checkGlobalThis();

  expect(globalThis[testFlag]).toBeTruthy();

  rstest.unstubAllGlobals();

  expect(globalThis[testFlag]).toBeUndefined();
});
