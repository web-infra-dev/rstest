import { test } from '@rstest/core';

test('keeps the worker alive while a.test.ts logs late', async () => {
  // Stay running long enough for a.test.ts's late `setTimeout` to fire.
  await new Promise((resolve) => setTimeout(resolve, 1000));
});
