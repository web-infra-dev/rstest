import { afterEach, beforeEach, describe, test } from '@rstest/core';

describe('extended and plain tests', () => {
  type ExtendedFixtures = {
    extendedValue: string;
  };

  const extendedTest = test.extend<ExtendedFixtures>({
    extendedValue: 'extended',
  });

  beforeEach<ExtendedFixtures>(({ extendedValue }) => {
    if (extendedValue === undefined) {
      throw new Error('hook callback received a missing extendedValue');
    }
  });

  extendedTest('provides the hook fixture', () => {});
  test('does not provide the hook fixture', () => {});
});

describe('incompatible extended tests', () => {
  type FirstFixtures = {
    firstValue: string;
  };

  const firstTest = test.extend<FirstFixtures>({
    firstValue: 'first',
  });
  const secondTest = test.extend({
    secondValue: 'second',
  });

  afterEach<FirstFixtures>(({ firstValue }) => {
    if (firstValue === undefined) {
      throw new Error('afterEach received a missing firstValue');
    }
  });

  firstTest('provides the first hook fixture', () => {});
  secondTest('does not provide the first hook fixture', () => {});
});

describe('beforeEach cleanup', () => {
  type CleanupFixtures = {
    cleanupValue: string;
  };

  const cleanupTest = test.extend<CleanupFixtures>({
    cleanupValue: 'cleanup',
  });

  beforeEach<CleanupFixtures>(() => {
    return ({ cleanupValue }) => {
      if (cleanupValue === undefined) {
        throw new Error('cleanup received a missing cleanupValue');
      }
    };
  });

  cleanupTest('provides the cleanup fixture', () => {});
  test('does not provide the cleanup fixture', () => {});
});
