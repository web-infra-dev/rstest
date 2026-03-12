import { expect } from '@rstest/core';
// biome-ignore lint/performance/noNamespaceImport: jest-dom matchers are consumed as a matcher namespace.
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';

void jestDomMatchers;
expect.extend({});
