import { formatName, formatTestError } from '../../src/runtime/util';

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
    const [error] = await formatTestError(
      new ReferenceError('cov_15453043885016330810 is not defined'),
    );

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
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      __RSTEST_BROWSER_OPTIONS__: {},
    };

    try {
      const [error] = await formatTestError(
        new ReferenceError('cov_15453043885016330810 is not defined'),
      );

      expect(error.message).toContain('coverage.exclude');
      expect(error.message).toContain('Istanbul ignore hint');
      expect(error.message).not.toContain("coverage.provider: 'v8'");
      expect(error.message).toContain(
        'avoid serializing Istanbul-instrumented functions',
      );
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('does not add the Istanbul hint for normal reference errors', async () => {
    const [error] = await formatTestError(
      new ReferenceError('foo is not defined'),
    );

    expect(error.message).toBe('foo is not defined');
  });
});
