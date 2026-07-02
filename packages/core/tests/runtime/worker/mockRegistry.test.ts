import { describe, expect, it } from '@rstest/core';
import {
  getNativeMock,
  getRegistryVersion,
  setNativeMock,
  unsetNativeMock,
} from '../../../src/runtime/worker/mockRegistry';

describe('mockRegistry alias groups', () => {
  it('serves one entry under every alias and clears the whole group from any alias', () => {
    setNativeMock(['group:a', 'group:b'], () => ({ tag: 'A' }));

    expect(getNativeMock('group:a')).toEqual({ tag: 'A' });
    // Same entry (memoized produce), not a re-run.
    expect(getNativeMock('group:b')).toBe(getNativeMock('group:a'));

    // Unmock computed from the OTHER spelling clears both.
    unsetNativeMock(['group:b']);
    expect(getNativeMock('group:a')).toBeUndefined();
    expect(getNativeMock('group:b')).toBeUndefined();
  });

  it('evicts every stale alias when a re-mock registers a smaller group', () => {
    setNativeMock(['re:a', 're:b'], () => ({ tag: 'old' }));
    setNativeMock(['re:a'], () => ({ tag: 'new' }));

    expect(getNativeMock('re:a')).toEqual({ tag: 'new' });
    // 're:b' must not keep serving the previous mock.
    expect(getNativeMock('re:b')).toBeUndefined();

    unsetNativeMock(['re:a']);
  });

  it('runs the producer lazily and at most once across aliases', () => {
    let calls = 0;
    setNativeMock(['lazy:a', 'lazy:b'], () => {
      calls++;
      return { tag: 'lazy' };
    });
    expect(calls).toBe(0);

    getNativeMock('lazy:a');
    getNativeMock('lazy:b');
    expect(calls).toBe(1);

    unsetNativeMock(['lazy:a']);
  });

  it('bumps the version on set and on effective unset only', () => {
    const before = getRegistryVersion();
    setNativeMock(['ver:a'], () => ({}));
    expect(getRegistryVersion()).toBe(before + 1);

    unsetNativeMock(['ver:missing']);
    expect(getRegistryVersion()).toBe(before + 1);

    unsetNativeMock(['ver:a']);
    expect(getRegistryVersion()).toBe(before + 2);
  });

  it('ignores an empty key group', () => {
    const before = getRegistryVersion();
    setNativeMock([], () => ({}));
    expect(getRegistryVersion()).toBe(before);
  });
});
