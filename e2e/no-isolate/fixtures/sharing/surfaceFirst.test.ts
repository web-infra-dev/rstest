import { test } from './surfaceHelper';

// Exists only so surfaceSecond is a NON-FIRST file in the reused worker.
test('surfaceFirst: warmup', ({ expect }) => {
  expect(true).toBe(true);
});
