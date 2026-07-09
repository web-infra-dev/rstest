import { afterEach, expect } from '@rstest/core';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

expect.extend(jestDomMatchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});
