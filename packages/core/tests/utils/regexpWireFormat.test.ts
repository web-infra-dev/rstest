import { describe, expect, it } from '@rstest/core';
import { unwrapRegex, wrapRegex } from '../../src/utils/regexpWireFormat';

describe('regexp wire-format codec', () => {
  it('round-trips a simple RegExp', () => {
    const wrapped = wrapRegex(/foo/i);
    expect(wrapped).toBe('RSTEST_REGEXP:/foo/i');

    const unwrapped = unwrapRegex(wrapped);
    expect(unwrapped).toBeInstanceOf(RegExp);
    expect((unwrapped as RegExp).source).toBe('foo');
    expect((unwrapped as RegExp).flags).toBe('i');
  });

  it('preserves d/s/v flags (regression: the old [gimuy] charset dropped them)', () => {
    for (const re of [/foo/d, /foo/s, /foo/v, /my test foo/dsv]) {
      const decoded = unwrapRegex(wrapRegex(re));
      expect(decoded).toBeInstanceOf(RegExp);
      expect((decoded as RegExp).flags).toBe(re.flags);
      expect((decoded as RegExp).source).toBe(re.source);
    }

    const decoded = unwrapRegex(wrapRegex(/my test foo/dsv)) as RegExp;
    expect(decoded.test('my test foo')).toBe(true);
  });

  it('passes through plain strings unchanged', () => {
    expect(unwrapRegex('my test name')).toBe('my test name');
  });

  it('returns the raw value when the sentinel wraps a non-regexp payload', () => {
    expect(unwrapRegex('RSTEST_REGEXP:not-a-regex')).toBe(
      'RSTEST_REGEXP:not-a-regex',
    );
  });
});
