import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

const never = () => new Promise<never>(() => {});
const wait = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration));

let fileHookCallbackRan = false;
const fileTimeoutTest = test.extend('slowFile', { scope: 'file' }, async () => {
  await wait(70);
  return 'slow';
});

describe('beforeEach fixture timeout', () => {
  const timeoutTest = test.extend<{ slowFixture: string }>({
    slowFixture: async () => never(),
  });

  beforeEach<{ slowFixture: string }>(({ slowFixture }) => {
    void slowFixture;
  });

  timeoutTest('times out fixture setup', () => {});
});

describe('afterEach fixture timeout', () => {
  const timeoutTest = test.extend<{ slowFixture: string }>({
    slowFixture: async () => never(),
  });

  afterEach<{ slowFixture: string }>(({ slowFixture }) => {
    void slowFixture;
  });

  timeoutTest('times out fixture setup', () => {});
});

describe('beforeEach cleanup fixture timeout', () => {
  const timeoutTest = test.extend<{ slowFixture: string }>({
    slowFixture: async () => never(),
  });

  beforeEach<{ slowFixture: string }>(
    () =>
      ({ slowFixture }: { slowFixture: string }) => {
        void slowFixture;
      },
    30,
  );

  timeoutTest('times out cleanup fixture setup', () => {});
});

let lateTeardownFinished = false;

describe('late fixture teardown', () => {
  const timeoutTest = test.extend<{ slowFixture: string }>({
    slowFixture: async (_context, use) => {
      await wait(70);
      await use('slow');
      await wait(80);
      lateTeardownFinished = true;
      throw new Error('late fixture teardown failed');
    },
  });

  beforeEach<{ slowFixture: string }>(({ slowFixture }) => {
    void slowFixture;
  }, 50);

  timeoutTest('times out before fixture setup completes', () => {});
});

describe('file fixture hook timeout', () => {
  beforeEach<{ slowFile: string }>(({ slowFile }) => {
    void slowFile;
    fileHookCallbackRan = true;
  }, 20);

  fileTimeoutTest(
    'times out before shared file fixture setup completes',
    () => {
      throw new Error('test body should not run');
    },
  );
});

test('waits for late fixture teardown before continuing', () => {
  expect(lateTeardownFinished).toBe(true);
});

test('does not run a timed-out hook after file fixture setup completes', async () => {
  await wait(100);
  expect(fileHookCallbackRan).toBe(false);
});
