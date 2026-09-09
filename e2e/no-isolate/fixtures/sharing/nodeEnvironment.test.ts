// @rstest-environment node
import { expect, it } from '@rstest/core';

// Splits this jsdom project into two environment groups. A worker holds its
// environment for life under `isolate: false`, so the pool must give this file
// its own worker rather than reusing a jsdom one — otherwise DOM globals leak
// in here, and the jsdom files lose the captures they took at module-eval time.
it('a node-environment file sees no DOM globals', () => {
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
});
