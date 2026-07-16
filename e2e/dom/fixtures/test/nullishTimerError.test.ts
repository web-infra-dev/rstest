import { setTimeout as nodeSetTimeout } from 'node:timers';
import { test } from '@rstest/core';

test('reports a nullish timer error', async () => {
  setTimeout(() => {
    throw undefined;
  }, 0);

  // happy-dom timers report directly through Node's uncaughtException path.
  await new Promise((resolve) => nodeSetTimeout(resolve, 20));
});
