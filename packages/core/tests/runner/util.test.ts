import {
  formatName,
  formatTestError,
  resolveEachArgs,
} from '../../src/runtime/util';

describe('resolveEachArgs', () => {
  it('spreads every row when the whole table is arrays', () => {
    expect(
      resolveEachArgs([
        [1, 2],
        [3, 4],
      ]),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('passes each row whole once any row is not an array', () => {
    expect(resolveEachArgs([null, 42, ['a']])).toEqual([[null], [42], [['a']]]);
    expect(resolveEachArgs([{ a: 1 }, { a: 2 }])).toEqual([
      [{ a: 1 }],
      [{ a: 2 }],
    ]);
  });

  it('treats a hole as a single undefined argument', () => {
    const sparse: (number[] | undefined)[] = [];
    sparse[0] = [1];
    sparse[2] = [2];
    expect(resolveEachArgs(sparse)).toEqual([[[1]], [undefined], [[2]]]);
  });

  it('returns no rows for an empty table', () => {
    expect(resolveEachArgs([])).toEqual([]);
  });
});

it('test formatName', () => {
  expect(formatName('test index %#', [1, 2, 3], 1)).toBe('test index 1');

  expect(formatName('test %i + %i -> %i', [1, 2, 3], 0)).toBe(
    'test 1 + 2 -> 3',
  );

  expect(formatName('test $a', { a: 1 }, 0)).toBe('test 1');

  expect(formatName('test $a.b', { a: { b: 1 } }, 0)).toBe('test 1');

  expect(formatName('test $c', { a: { b: 1 } }, 0)).toBe('test undefined');

  expect(formatName('%j', { a: { b: 1 } }, 0)).toBe('{"a":{"b":1}}');
});

describe('formatTestError', () => {
  it('adds a hint for missing Istanbul coverage helpers', async () => {
    const error = (
      await formatTestError(
        new ReferenceError('cov_15453043885016330810 is not defined'),
      )
    )[0]!;

    expect(error.message).toContain('cov_15453043885016330810 is not defined');
    expect(error.message).toContain('Istanbul coverage counter');
    expect(error.message).toContain('coverage.exclude');
    expect(error.message).toContain('Istanbul ignore hint');
    expect(error.message).toContain("coverage.provider: 'v8'");
    expect(error.message).toContain(
      'avoid serializing Istanbul-instrumented functions',
    );
  });

  it('does not suggest the V8 coverage provider in browser mode', async () => {
    const hadWindow = 'window' in globalThis;
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      __RSTEST_BROWSER_OPTIONS__: {},
    };

    try {
      const error = (
        await formatTestError(
          new ReferenceError('cov_15453043885016330810 is not defined'),
        )
      )[0]!;

      expect(error.message).toContain('coverage.exclude');
      expect(error.message).toContain('Istanbul ignore hint');
      expect(error.message).not.toContain("coverage.provider: 'v8'");
      expect(error.message).toContain(
        'avoid serializing Istanbul-instrumented functions',
      );
    } finally {
      if (hadWindow) {
        (globalThis as { window?: unknown }).window = originalWindow;
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
    }
  });

  it('does not add the Istanbul hint for normal reference errors', async () => {
    const error = (
      await formatTestError(new ReferenceError('foo is not defined'))
    )[0]!;

    expect(error.message).toBe('foo is not defined');
  });
});
