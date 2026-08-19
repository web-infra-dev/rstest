import { describe, expect, it } from '@rstest/core';
import { createWatchRerunController } from '../../../src/core/plugins/entry';

describe('watch rerun controller', () => {
  it('keeps virtual-entry triggers isolated between watch sessions', () => {
    const first = createWatchRerunController();
    const second = createWatchRerunController();
    const calls: string[] = [];

    first.register(
      'test',
      '/workspace/node_modules/.cache/rstest/first.js',
      () => calls.push('first'),
    );
    second.register(
      'test',
      '/workspace/node_modules/.cache/rstest/second.js',
      () => calls.push('second'),
    );

    expect(first.trigger()).toBe(true);
    expect(calls).toEqual(['first']);
    expect(second.trigger()).toBe(true);
    expect(calls).toEqual(['first', 'second']);

    first.markVirtualEntryChange(
      new Set(['/workspace/src/ordinary-change.test.ts']),
    );
    expect(first.consumeVirtualEntryChange()).toBe(false);

    first.markVirtualEntryChange(
      '/workspace/node_modules/.cache/rstest/first.js',
    );
    expect(first.consumeVirtualEntryChange()).toBe(true);

    first.markVirtualEntryChange(
      new Set(['/workspace/node_modules/.cache/rstest/first.js']),
    );
    expect(first.consumeVirtualEntryChange()).toBe(true);
    expect(second.consumeVirtualEntryChange()).toBe(false);

    first.clear();
    expect(first.trigger()).toBe(false);
  });
});
