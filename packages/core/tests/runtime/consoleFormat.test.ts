import { format as nodeFormat } from 'node:util';
import { describe, expect, it } from '@rstest/core';
import { formatConsoleArgs } from '../../src/runtime/consoleFormat';

describe('formatConsoleArgs (node util.format parity)', () => {
  it('matches node byte-for-byte for representative inputs', () => {
    const cases: unknown[][] = [
      ['plain string'],
      ['multi', 'arg', 123, true],
      [{ key: 'value', nested: { a: 1 } }],
      ['TAG', { key: 'value', nested: { a: 1 } }],
      [[1, 2, 3, 'four']],
      ['TAG', [1, 2, 3, 'four']],
      [null, undefined],
      ['n: %d', '42px'],
      ['n: %i', '42px'],
      ['s: %s', 'text'],
      ['padded %s tail', 'mid', 'extra'],
      ['100%% %s', 'sure'],
    ];

    for (const args of cases) {
      expect(formatConsoleArgs(args)).toBe(nodeFormat(...args));
    }
  });

  it('consumes %c styling directives like node', () => {
    expect(formatConsoleArgs(['%cStyled', 'font-weight:bold'])).toBe(
      nodeFormat('%cStyled', 'font-weight:bold'),
    );
  });

  it('emits the Error stack like node inspection does', () => {
    const error = new Error('BOOM');
    const formatted = formatConsoleArgs(['TAG', error]);
    expect(formatted.startsWith('TAG Error: BOOM')).toBe(true);
    expect(formatted).toContain('\n    at ');
    // Leading-position errors keep their stack too (browser relay behavior).
    expect(formatConsoleArgs([error])).toContain('\n    at ');
  });

  it('documents the accepted collection-rendering divergences from node', () => {
    // node: "Map(1) { 'k' => 'v' }" / "Set(1) { 'v' }". The browser-safe
    // inspector drops the size prefix; everything else matches.
    expect(formatConsoleArgs([new Map([['k', 'v']])])).toBe(
      "Map{ 'k' => 'v' }",
    );
    expect(formatConsoleArgs([new Set(['v'])])).toBe("Set{ 'v' }");
  });
});
