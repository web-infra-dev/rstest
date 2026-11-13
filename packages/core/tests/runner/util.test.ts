import { format as nodeFormat } from 'node:util';
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

  expect(formatName('%d and %i', [1.5, 1.5], 0)).toBe('1.5 and 1');
  expect(formatName('%d %i %f', ['1.5px', '1.5px', '1.5px'], 0)).toBe(
    'NaN 1 1.5',
  );
  expect(formatName('%d %f', ['', ''], 0)).toBe('0 NaN');
  expect(formatName('%d %i %f', [10n, 10n, 10n], 0)).toBe('10n 10n 10');

  expect(formatName('test $a', { a: 1 }, 0)).toBe('test 1');

  expect(formatName('test $a.b', { a: { b: 1 } }, 0)).toBe('test 1');

  expect(formatName('test $c', { a: { b: 1 } }, 0)).toBe('test undefined');

  expect(formatName('test $a.b', { a: null }, 0)).toBe('test undefined');

  expect(formatName('test $a', { a: null }, 0)).toBe('test null');

  expect(formatName('%j', { a: { b: 1 } }, 0)).toBe('{"a":{"b":1}}');
});

it('formats %s, %o, %O and %c in each names like util.format', () => {
  class Named {
    toString() {
      return 'named';
    }
  }
  const values: unknown[] = [
    { a: 1 },
    'text',
    42,
    10n,
    -0,
    null,
    undefined,
    true,
    Symbol('s'),
  ];

  for (const value of values) {
    for (const specifier of ['%s', '%o', '%O']) {
      const template = `value ${specifier} end`;
      expect(formatName(template, [value], 0)).toBe(
        nodeFormat(template, value),
      );
    }
  }

  expect(formatName('value %s', [{ a: 1 }], 0)).toBe('value { a: 1 }');
  expect(formatName('value %o', [{ a: 1 }], 0)).toBe('value { a: 1 }');
  expect(formatName('value %O', [['a', 1]], 0)).toBe("value [ 'a', 1 ]");
  expect(formatName('value %O', [{ a: { b: 1 }, list: ['x'] }], 0)).toBe(
    "value { a: { b: 1 }, list: [ 'x' ] }",
  );
  expect(formatName('value %o', ['a'], 0)).toBe("value 'a'");
  // A custom `toString` is used for `%s`.
  expect(formatName('value %s', [new Named()], 0)).toBe('value named');
  // A row that is not an array is the only value.
  expect(formatName('value %o', { a: 1 }, 0)).toBe('value { a: 1 }');

  // `%c` takes its value and prints nothing.
  expect(formatName('%c%s styled', ['color: red', 'name'], 0)).toBe(
    'name styled',
  );
});

it('only substitutes placeholders from the original each name template', () => {
  const row = { price: '$10', label: '%s $price' };

  for (const specifier of ['%s', '%o', '%O']) {
    expect(formatName(`$price ${specifier} $label`, row, 0)).toBe(
      "$10 { price: '$10', label: '%s $price' } %s $price",
    );
  }
  expect(formatName('$price %j', row, 0)).toBe(
    '$10 {"price":"$10","label":"%s $price"}',
  );
  expect(formatName('$price %s', ['$10'], 0)).toBe('$price $10');
  expect(formatName('%%s %# %$ $price %o', row, 2)).toBe(
    "%s 2 3 $10 { price: '$10', label: '%s $price' }",
  );
});

it('formats circular collections without overflowing during each registration', () => {
  const map = new Map<string, unknown>();
  map.set('self', map);
  const set = new Set<unknown>();
  set.add(set);
  const array: unknown[] = [];
  array.push(array);

  for (const value of [map, set, array]) {
    for (const specifier of ['%o', '%O']) {
      expect(formatName(`value ${specifier}`, [value], 0)).toContain(
        '[Circular]',
      );
    }
  }
  expect(formatName('value %s', [map], 0)).toContain('[Circular]');
  expect(formatName('value %s', [set], 0)).toContain('[Circular]');
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
