import { afterEach, beforeEach, describe, test } from '@rstest/core';

const never = () => new Promise<never>(() => {});

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
