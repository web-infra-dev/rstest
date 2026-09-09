import { expect } from '@rstest/core';
import { toBeInTheDocument } from '@testing-library/jest-dom/matchers';

expect.extend({
  toBeInTheDocument,
});
