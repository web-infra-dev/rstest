// Setup file that runs before all tests
(globalThis as Record<string, unknown>).__SETUP_EXECUTED__ = true;
(globalThis as Record<string, unknown>).__SETUP_TIMESTAMP__ = Date.now();

// Add a custom matcher or global utility
(globalThis as Record<string, unknown>).__customHelper__ = (value: string) => {
  return value.toUpperCase();
};
