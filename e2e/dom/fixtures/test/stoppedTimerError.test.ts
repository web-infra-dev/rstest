import { test } from '@rstest/core';

test('reports a timer error after DOM propagation is stopped', async () => {
  const observed = new Promise<void>((resolve) => {
    window.addEventListener(
      'error',
      (event) => {
        event.stopImmediatePropagation();
        queueMicrotask(() => event.preventDefault());
        resolve();
      },
      { capture: true, once: true },
    );
  });

  setTimeout(() => {
    throw new Error('stopped timer error');
  }, 0);

  await observed;
});
