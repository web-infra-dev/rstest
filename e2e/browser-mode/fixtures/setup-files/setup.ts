import { beforeEach } from '@rstest/core';

// Setup file that runs before all tests
(globalThis as Record<string, unknown>).__SETUP_EXECUTED__ = true;
(globalThis as Record<string, unknown>).__SETUP_TIMESTAMP__ = Date.now();
(globalThis as Record<string, unknown>).__SETUP_BEFORE_EACH_COUNT__ = 0;

// Add a custom matcher or global utility
(globalThis as Record<string, unknown>).__customHelper__ = (value: string) => {
  return value.toUpperCase();
};

beforeEach(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.__SETUP_BEFORE_EACH_COUNT__ =
    (globals.__SETUP_BEFORE_EACH_COUNT__ as number) + 1;
});
