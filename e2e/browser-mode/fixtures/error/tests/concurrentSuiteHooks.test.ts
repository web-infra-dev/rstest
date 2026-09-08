import { beforeAll, describe, test } from '@rstest/core';

let startedHooks = 0;
let releaseHooks: (() => void) | undefined;
const bothHooksStarted = new Promise<void>((resolve) => {
  releaseHooks = resolve;
});

const waitForSiblingHook = async () => {
  startedHooks++;
  if (startedHooks === 2) {
    releaseHooks?.();
  }
  await bothHooksStarted;
};

describe.concurrent('first concurrent suite', () => {
  beforeAll(waitForSiblingHook, 1000);
  test('runs after both hooks start', () => {});
});

describe.concurrent('second concurrent suite', () => {
  beforeAll(waitForSiblingHook, 1000);
  test('runs after both hooks start', () => {});
});
