import { test } from '@rstest/core';

test('reports an observed nullish timer error', async () => {
  const observed = new Promise<void>((resolve) => {
    window.addEventListener(
      'error',
      () => {
        // Observing an error without preventDefault() must not handle it.
        resolve();
      },
      { once: true },
    );
  });

  setTimeout(() => {
    throw undefined;
  }, 0);

  await observed;
});
