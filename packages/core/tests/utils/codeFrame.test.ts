import { describe, expect, it } from '@rstest/core';
import { createColors } from 'picocolors';
import { generateCodeFrame } from '../../src/utils/codeFrame';

const plain = createColors(false);

describe('generateCodeFrame', () => {
  it('shows two lines of context and a one-based column pointer', () => {
    expect(
      generateCodeFrame('one\ntwo\nthree\nfour\nfive\nsix\nseven', 4, 3, plain),
    ).toBe(
      [
        '  2 | two',
        '  3 | three',
        '> 4 | four',
        '    |   ^',
        '  5 | five',
        '  6 | six',
      ].join('\n'),
    );
  });

  it('clips context at the beginning and end of a file', () => {
    expect(generateCodeFrame('first\nlast', 1, 1, plain)).toBe(
      '> 1 | first\n    | ^\n  2 | last',
    );
    expect(generateCodeFrame('first\nlast', 2, 5, plain)).toBe(
      '  1 | first\n> 2 | last\n    |     ^',
    );
  });

  it('aligns gutters across a change in line number width', () => {
    const source = Array.from({ length: 11 }, () => 'x').join('\n');
    expect(generateCodeFrame(source, 9, 1, plain)).toBe(
      [
        '   7 | x',
        '   8 | x',
        '>  9 | x',
        '     | ^',
        '  10 | x',
        '  11 | x',
      ].join('\n'),
    );
  });

  it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])(
    'supports %j line endings',
    (newline) => {
      expect(generateCodeFrame(`first${newline}last`, 2, 1, plain)).toBe(
        '  1 | first\n> 2 | last\n    | ^',
      );
    },
  );

  it('preserves tabs before the pointer', () => {
    expect(generateCodeFrame('\tfoo\tbar', 1, 6, plain)).toBe(
      '> 1 | \tfoo\tbar\n    | \t   \t^',
    );
  });

  it('handles empty lines and columns past the end of a line', () => {
    expect(generateCodeFrame('first\n', 2, 1, plain)).toBe(
      '  1 | first\n> 2 |\n    | ^',
    );
    expect(generateCodeFrame('abc', 1, 100, plain)).toBe(
      '> 1 | abc\n    |    ^',
    );
  });

  it.each([null, 0, -1])('omits the pointer for column %s', (column) => {
    expect(generateCodeFrame('abc', 1, column, plain)).toBe('> 1 | abc');
  });

  it.each([null, 0, -1, 2])('omits an unavailable line %s', (line) => {
    expect(generateCodeFrame('abc', line, 1, plain)).toBe('');
  });

  it('colors only gutters and markers, leaving source code unchanged', () => {
    const colors = createColors(true);
    const source = 'const value = "hello";';
    expect(generateCodeFrame(source, 1, 7, colors)).toBe(
      `${colors.red(colors.bold('>'))} ${colors.gray('1 |')} ${source}\n  ${colors.gray('  |')}       ${colors.red(colors.bold('^'))}`,
    );
  });
});
