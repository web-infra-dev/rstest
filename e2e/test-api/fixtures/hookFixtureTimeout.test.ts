import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

const never = () => new Promise<never>(() => {});
const wait = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration));

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

test('waits for late fixture teardown before continuing', () => {
  expect(lateTeardownFinished).toBe(true);
});
