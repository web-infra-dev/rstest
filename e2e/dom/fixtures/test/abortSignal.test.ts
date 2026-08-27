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

  controller.signal.addEventListener('abort', (event) =>
    event.stopImmediatePropagation(),
  );
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

test('rejects values that are not AbortSignal instances', () => {
  expect(() => {
    document.addEventListener('rstest-invalid-abort-signal', () => {}, {
      signal: { aborted: true } as AbortSignal,
    });
  }).toThrow("member 'signal' that is not of type 'AbortSignal'");
});

test('preserves Web IDL conversion order for callable options', () => {
  const controller = new AbortController();
  const reads: string[] = [];
  const options = () => {};
  Object.setPrototypeOf(options, {
    get once() {
      reads.push('once');
      return true;
    },
  });
  Object.defineProperties(options, {
    capture: {
      get() {
        reads.push('capture');
        return false;
      },
    },
    passive: {
      get() {
        reads.push('passive');
        return false;
      },
    },
    signal: {
      get() {
        reads.push('signal');
        return controller.signal;
      },
    },
  });
  const type = {
    toString() {
      reads.push('type');
      return 'rstest-listener-option-order';
    },
  };

  document.addEventListener(
    type as unknown as string,
    () => {},
    options as unknown as AddEventListenerOptions,
  );

  expect(reads).toEqual(['type', 'capture', 'once', 'passive', 'signal']);
});
