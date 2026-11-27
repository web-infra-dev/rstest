import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, rs } from '@rstest/core';

it('restores overwritten properties while their target is still reachable', async () => {
  const gc: () => void = runInNewContext('gc');
  const original = () => 'original';
  const replacement = () => 'replacement';
  const target = { read: original, write: original };
  rs.spyOn(target, 'read');
  rs.spyOn(target, 'write');
  target.read = replacement;
  target.write = replacement;

  const discarded = (() => {
    const other = { method: original };
    const spy = rs.spyOn(other, 'method');
    const mock = rs.fn().mockReturnValue(1);
    mock();
    mock.mockClear = () => mock;
    return [new WeakRef(other), new WeakRef(spy), new WeakRef(mock)];
  })();
  for (let i = 0; i < 5; i++) {
    await setImmediate();
    gc();
  }

  rs.restoreAllMocks();
  expect(target.read).toBe(original);
  expect(target.write).toBe(original);
  for (const ref of discarded) {
    expect(ref.deref()).toBeUndefined();
  }
});
