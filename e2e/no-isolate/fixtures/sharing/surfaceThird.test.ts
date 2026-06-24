import { expect, test } from './surfaceHelper';

// Proves surfaceSecond's shared `afterAll` actually ran (it bound to that file
// and fired at its teardown), not silently dropped into a stale collector.
test('surfaceThird: previous file shared afterAll fired', () => {
  expect((globalThis as Record<string, any>).__rstestSurfaceAfterAll).toBe(
    true,
  );
});
