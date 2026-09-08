import { runInContext } from 'node:vm';
import { expect, test } from '@rstest/core';
import { setupVM } from '../../../../src/runtime/worker/env/happyDom';

test('keeps Happy DOM VM contexts on their own intrinsic constructors', async () => {
  const first = await setupVM({}, { scope: 'file' });
  const intrinsicKey = '__rstestHappyDOMIntrinsic__';

  try {
    const firstGlobal = runInContext(
      'globalThis',
      first.context,
    ) as typeof globalThis;
    const isVmUint8Array = runInContext(
      '(value) => value instanceof Uint8Array',
      first.context,
    ) as (value: unknown) => boolean;

    expect(firstGlobal.Uint8Array).not.toBe(Uint8Array);
    expect(isVmUint8Array(new firstGlobal.Uint8Array())).toBe(true);
    runInContext(`Uint8Array.prototype.${intrinsicKey} = true`, first.context);
  } finally {
    await first.teardown();
  }

  const second = await setupVM({}, { scope: 'file' });
  try {
    expect(
      runInContext(`Uint8Array.prototype.${intrinsicKey}`, second.context),
    ).toBeUndefined();
  } finally {
    await second.teardown();
  }
});
