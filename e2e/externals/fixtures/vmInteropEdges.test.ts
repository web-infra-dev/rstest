import { createRequire } from 'node:module';
import { setTimeout as delay, scheduler } from 'node:timers/promises';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { expect, it } from '@rstest/core';

it('preserves the default fetch abort DOMException', async () => {
  const signal = AbortSignal.abort();
  await expect(fetch('data:text/plain,unused', { signal })).rejects.toBe(
    signal.reason,
  );
  expect(signal.reason).toMatchObject({ name: 'AbortError', code: 20 });
  expect(signal.reason).toBeInstanceOf(DOMException);
});

it.each(['before', 'after'] as const)(
  'preserves the signal reason when aborting promise timers %s scheduling',
  async (timing) => {
    const reason = { source: 'caller' };
    const controller = new AbortController();
    if (timing === 'before') controller.abort(reason);
    const options = { signal: controller.signal };
    const pending = [
      delay(1000, undefined, options),
      scheduler.wait(1000, options),
      promisify(setTimeout)(1000, undefined, options),
      promisify(setImmediate)(undefined, options),
    ];
    controller.abort(reason);
    for (const promise of pending) {
      await expect(promise).rejects.toSatisfy((error) => {
        expect(error).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
        expect(error.cause).toBe(reason);
        expect(Object.getOwnPropertyDescriptor(error, 'cause')).toMatchObject({
          enumerable: false,
          configurable: true,
          writable: true,
        });
        return true;
      });
    }
  },
);

it('preserves require(esm) data descriptors and live bindings', () => {
  if (!('hasAsyncGraph' in vm.SourceTextModule.prototype)) return;
  const require = createRequire(import.meta.url);
  const namespace = require('test-vm-external/require-namespace.mjs');
  expect(namespace.__esModule).toBe(true);
  for (const key of ['default', 'value']) {
    expect(Object.getOwnPropertyDescriptor(namespace, key)).toEqual({
      value: 1,
      writable: true,
      enumerable: true,
      configurable: false,
    });
    expect(Reflect.set(namespace, key, 99)).toBe(false);
  }
  namespace.increment();
  expect(namespace.default).toBe(2);
  expect(Object.getOwnPropertyDescriptor(namespace, 'value')?.value).toBe(2);
  expect(require('test-vm-external/require-namespace.mjs')).toBe(namespace);
});

it('links a CJS bundle to its direct external child', () => {
  if (process.env.RSTEST_OUTPUT_MODULE !== 'false') return;
  // Keep this as a runtime require; static externals may use async import.
  const specifier = 'test-vm-external/bundle-child.cjs';
  const child = require(specifier);
  expect(child.parent?.filename).toContain('vmInteropEdges.test.ts');
  expect(child.linked).toBe(true);
  expect(child.parent.loaded).toBe(true);
});
