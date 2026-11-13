import { test } from '@rstest/core';

// Long enough that files of different browsers overlap when the pool allows it.
test('holds its browser for a moment', async () => {
  await new Promise((resolve) => setTimeout(resolve, 1500));
});
