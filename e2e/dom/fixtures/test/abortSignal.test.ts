import { expect, test } from '@rstest/core';

test('accepts Node AbortSignal in DOM event listeners', () => {
  const controller = new AbortController();
  let calls = 0;
  const type = 'rstest-abort-signal';

  document.addEventListener(type, () => calls++, {
    signal: controller.signal,
  });
  document.dispatchEvent(new Event(type));
  expect(calls).toBe(1);

  controller.abort();
  document.dispatchEvent(new Event(type));
  expect(calls).toBe(1);
});
