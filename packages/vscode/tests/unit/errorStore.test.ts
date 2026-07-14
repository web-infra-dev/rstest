import { describe, expect, it } from '@rstest/core';
import { TestErrorStore, testMessageText } from '../../src/errorStore';

const item = (id: string) => ({ id }) as any;
const msg = (message: unknown) => ({ message }) as any;

describe('TestErrorStore', () => {
  it('stores and returns messages per test item', () => {
    const store = new TestErrorStore();
    const a = item('a');
    const b = item('b');
    store.set(a, [msg('boom')]);
    expect(store.get(a).map((m) => m.message)).toEqual(['boom']);
    // unknown item has no errors
    expect(store.get(b)).toEqual([]);
  });

  it('clears entries, and an empty set removes them', () => {
    const store = new TestErrorStore();
    const a = item('a');
    store.set(a, [msg('boom')]);
    store.clear(a);
    expect(store.get(a)).toEqual([]);

    store.set(a, [msg('again')]);
    store.set(a, []); // overwriting with no messages
    expect(store.get(a)).toEqual([]);
  });
});

describe('testMessageText', () => {
  it('returns string messages verbatim', () => {
    expect(testMessageText(msg('plain error'))).toBe('plain error');
  });

  it('reads the value of a MarkdownString message', () => {
    expect(testMessageText(msg({ value: '**bold** error' }))).toBe(
      '**bold** error',
    );
  });
});
