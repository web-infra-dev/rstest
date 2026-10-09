import { afterEach, expect } from '@rstest/core';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

expect.extend(jestDomMatchers);

// Under `isolate: false` one DOM is shared by every file in a worker. Unmount
// what `render` appended so the next file's `getByText` sees a single match.
afterEach(cleanup);
