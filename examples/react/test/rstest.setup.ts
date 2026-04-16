import { afterEach, expect } from '@rstest/core';
// biome-ignore lint/performance/noNamespaceImport: jest-dom matchers are consumed as a matcher namespace.
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

expect.extend(jestDomMatchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});
