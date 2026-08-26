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

test('accepts Node AbortSignal in frames event listeners', () => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const frame = frames[0]!;
  const frameDocument = frame.document;
  const controller = new AbortController();
  let calls = 0;
  const type = 'rstest-frames-abort-signal';

  frameDocument.addEventListener(type, () => calls++, {
    signal: controller.signal,
  });
  const event = frameDocument.createEvent('Event');
  event.initEvent(type);
  frameDocument.dispatchEvent(event);

  expect(calls).toBe(1);
  iframe.remove();
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
  iframe.remove();
});

test('preserves inherited listener options', () => {
  const controller = new AbortController();
  const options = Object.assign(Object.create({ once: true }), {
    signal: controller.signal,
  });
  let calls = 0;
  const type = 'rstest-inherited-listener-options';

  document.addEventListener(type, () => calls++, options);
  document.dispatchEvent(new Event(type));
  document.dispatchEvent(new Event(type));

  expect(calls).toBe(1);
});
