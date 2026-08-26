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

test('preserves an already-aborted Node signal', () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const type = 'rstest-aborted-signal';

  document.addEventListener(type, () => calls++, {
    signal: controller.signal,
  });
  document.dispatchEvent(new Event(type));

  expect(calls).toBe(0);
});

test('accepts Node AbortSignal in iframe event listeners', () => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const iframeDocument = iframe.contentDocument!;
  const controller = new AbortController();
  let calls = 0;
  const type = 'rstest-iframe-abort-signal';
  const dispatch = () => {
    const event = iframeDocument.createEvent('Event');
    event.initEvent(type);
    iframeDocument.dispatchEvent(event);
  };

  iframeDocument.addEventListener(type, () => calls++, {
    signal: controller.signal,
  });
  dispatch();
  expect(calls).toBe(1);

  controller.abort();
  dispatch();
  expect(calls).toBe(1);
});
