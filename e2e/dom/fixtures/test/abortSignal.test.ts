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

test('rejects values that are not AbortSignal instances', () => {
  expect(() => {
    document.addEventListener('rstest-invalid-abort-signal', () => {}, {
      signal: { aborted: true } as AbortSignal,
    });
  }).toThrow("member 'signal' that is not of type 'AbortSignal'");
});

test('reads a Node signal option once', () => {
  const controller = new AbortController();
  let reads = 0;
  const options = {
    get signal() {
      reads++;
      return controller.signal;
    },
  };

  document.addEventListener('rstest-signal-accessor', () => {}, options);

  expect(reads).toBe(1);
});

test('reads listener options in Web IDL order', () => {
  const controller = new AbortController();
  const reads: string[] = [];
  const options = {
    get capture() {
      reads.push('capture');
      return false;
    },
    get once() {
      reads.push('once');
      return true;
    },
    get passive() {
      reads.push('passive');
      return false;
    },
    get signal() {
      reads.push('signal');
      return controller.signal;
    },
  };

  document.addEventListener('rstest-listener-option-order', () => {}, options);

  expect(reads).toEqual(['capture', 'once', 'passive', 'signal']);
});

test('accepts callable listener options dictionaries', () => {
  const controller = new AbortController();
  const options = Object.assign(() => {}, { signal: controller.signal });
  let calls = 0;
  const type = 'rstest-callable-listener-options';

  document.addEventListener(
    type,
    () => calls++,
    options as unknown as AddEventListenerOptions,
  );
  document.dispatchEvent(new Event(type));
  expect(calls).toBe(1);

  controller.abort();
  document.dispatchEvent(new Event(type));
  expect(calls).toBe(1);
});
