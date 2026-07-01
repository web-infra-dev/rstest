import { describe, expect, it } from '@rstest/core';
import { formatConsoleArgs } from '../src/client/formatConsole';

describe('formatConsoleArgs', () => {
  it('joins plain arguments with a space when there is no specifier', () => {
    expect(formatConsoleArgs(['a', 'b', 1])).toBe('a b 1');
  });

  it('consumes %c and drops its style argument (React DevTools notice)', () => {
    expect(
      formatConsoleArgs([
        '%cDownload the React DevTools: https://react.dev/link/react-devtools',
        'font-weight:bold',
      ]),
    ).toBe(
      'Download the React DevTools: https://react.dev/link/react-devtools',
    );
  });

  it('substitutes %s with the following argument', () => {
    expect(formatConsoleArgs(['%s world', 'hello'])).toBe('hello world');
  });

  it('parses %d and %i as an integer like the browser console', () => {
    expect(formatConsoleArgs(['%d', 3.7])).toBe('3');
    expect(formatConsoleArgs(['%i things', 5.9])).toBe('5 things');
    expect(formatConsoleArgs(['%d', 'nope'])).toBe('NaN');
    // Unit-suffixed strings parse to their leading integer (parseInt), not NaN.
    expect(formatConsoleArgs(['%i', '42px'])).toBe('42');
  });

  it('parses %f as a float like the browser console', () => {
    expect(formatConsoleArgs(['%f', 3.5])).toBe('3.5');
    // Unit-suffixed strings parse to their leading float (parseFloat), not NaN.
    expect(formatConsoleArgs(['%f', '3.5ms'])).toBe('3.5');
  });

  it('formats a Symbol under numeric specifiers as NaN without throwing', () => {
    const sym = Symbol('id');
    expect(formatConsoleArgs(['%d', sym])).toBe('NaN');
    expect(formatConsoleArgs(['%i', sym])).toBe('NaN');
    expect(formatConsoleArgs(['%f', sym])).toBe('NaN');
  });

  it('renders %o / %O objects', () => {
    expect(formatConsoleArgs(['%o', { a: 1 }])).toBe('{\n  "a": 1\n}');
  });

  it('turns %% into a literal percent sign without consuming an argument', () => {
    expect(formatConsoleArgs(['100%% done', 'extra'])).toBe('100% done extra');
  });

  it('appends leftover arguments after substitution', () => {
    expect(formatConsoleArgs(['%s', 'a', 'b', 'c'])).toBe('a b c');
  });

  it('keeps a specifier literal when no argument is left to consume', () => {
    expect(formatConsoleArgs(['%s %s', 'a'])).toBe('a %s');
  });

  it('does not substitute when the first argument is not a string', () => {
    expect(formatConsoleArgs([{ a: 1 }, '%s'])).toBe('{\n  "a": 1\n} %s');
  });
});
