import { test } from '@rstest/core';

test('reports an observed nullish timer error', async () => {
  const observed = new Promise<void>((resolve) => {
    window.addEventListener('error', () => resolve(), { once: true });
  });

  setTimeout(() => {
    throw undefined;
  }, 0);

  await observed;
});

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
