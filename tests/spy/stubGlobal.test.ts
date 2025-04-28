import { expect, it, rstest } from '@rstest/core';

function checkGlobalThis() {
  // @ts-expect-error
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
