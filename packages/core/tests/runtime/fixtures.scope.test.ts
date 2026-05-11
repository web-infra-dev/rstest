import { describe, expect, it } from '@rstest/core';
import {
  createFileFixtureStore,
  flushFileFixtures,
  handleFixtures,
  normalizeBuilderFixture,
  normalizeFixtures,
} from '../../src/runtime/runner/fixtures';
import type { NormalizedFixtures, TestCase } from '../../src/types';

const makeTestCase = (
  fixtures: NormalizedFixtures,
  fn: (ctx: any) => unknown,
): TestCase =>
  ({
    fixtures,
    originalFn: fn,
  }) as unknown as TestCase;

describe('normalizeFixtures', () => {
  it('defaults to test scope and use-callback style for object syntax', () => {
    const result = normalizeFixtures({
      foo: async (_, use) => {
        await use(1);
      },
    });
    expect(result.foo!.scope).toBe('test');
    expect(result.foo!.style).toBe('use-callback');
  });

  it('reads scope from the array form', () => {
    const result = normalizeFixtures({
      foo: [
        async (_, use) => {
          await use(1);
        },
        { scope: 'file' },
      ],
    });
    expect(result.foo!.scope).toBe('file');
    expect(result.foo!.style).toBe('use-callback');
  });

  it('rejects worker scope with a clear error', () => {
    expect(() =>
      normalizeFixtures({
        foo: [
          async (_, use) => {
            await use(1);
          },
          { scope: 'worker' as any },
        ],
      }),
    ).toThrowError(/worker.*rstest.*supports "test".*"file"/i);
  });

  it('rejects unknown scope values', () => {
    expect(() =>
      normalizeFixtures({
        foo: [
          async (_, use) => {
            await use(1);
          },
          { scope: 'galaxy' as any },
        ],
      }),
    ).toThrowError(/Unsupported fixture scope "galaxy"/);
  });
});

describe('normalizeBuilderFixture', () => {
  it('marks the fixture as return-style', () => {
    const result = normalizeBuilderFixture(
      'foo',
      undefined,
      async (_, _helpers) => 42,
    );
    expect(result.foo!.scope).toBe('test');
    expect(result.foo!.style).toBe('return');
  });

  it('honors the scope option', () => {
    const result = normalizeBuilderFixture(
      'foo',
      { scope: 'file' },
      async (_, _helpers) => 42,
    );
    expect(result.foo!.scope).toBe('file');
  });

  it('throws when fn is not a function', () => {
    expect(() =>
      normalizeBuilderFixture('foo', undefined, 'not a fn' as any),
    ).toThrowError(/must be a function/);
  });

  it('throws on worker scope', () => {
    expect(() =>
      normalizeBuilderFixture(
        'foo',
        { scope: 'worker' as any },
        async (_, _helpers) => 42,
      ),
    ).toThrowError(/worker/);
  });
});

describe('validateFixtureScopes', () => {
  it('rejects file fixtures depending on test fixtures', () => {
    expect(() =>
      normalizeFixtures({
        a: async (_, use) => {
          await use(1);
        },
        b: [
          async ({ a }, use) => {
            await use(a + 1);
          },
          { scope: 'file' },
        ],
      }),
    ).toThrowError(
      /Fixture "b" \(file scope\) cannot depend on "a" \(test scope\)/,
    );
  });

  it('allows file fixtures depending on file fixtures', () => {
    expect(() =>
      normalizeFixtures({
        a: [
          async (_, use) => {
            await use(1);
          },
          { scope: 'file' },
        ],
        b: [
          async ({ a }, use) => {
            await use(a + 1);
          },
          { scope: 'file' },
        ],
      }),
    ).not.toThrowError();
  });

  it('allows test fixtures depending on file fixtures', () => {
    expect(() =>
      normalizeFixtures({
        a: [
          async (_, use) => {
            await use(1);
          },
          { scope: 'file' },
        ],
        b: async ({ a }, use) => {
          await use(a + 1);
        },
      }),
    ).not.toThrowError();
  });

  it('validates across extend() chain merges', () => {
    const base = normalizeFixtures({
      a: async (_, use) => {
        await use(1);
      },
    });
    expect(() =>
      normalizeBuilderFixture(
        'b',
        { scope: 'file' },
        async ({ a }, _helpers) => a + 1,
        base,
      ),
    ).toThrowError(
      /Fixture "b" \(file scope\) cannot depend on "a" \(test scope\)/,
    );
  });
});

describe('handleFixtures: file scope', () => {
  it('caches file-scoped fixture values across tests', async () => {
    const fixtures = normalizeBuilderFixture(
      'shared',
      { scope: 'file' },
      async (_, _helpers) => ({ instance: Symbol('once') }),
    );
    const store = createFileFixtureStore();

    const ctxA: any = {};
    await handleFixtures(
      makeTestCase(fixtures, ({ shared }: any) => shared),
      ctxA,
      store,
    );

    const ctxB: any = {};
    await handleFixtures(
      makeTestCase(fixtures, ({ shared }: any) => shared),
      ctxB,
      store,
    );

    expect(ctxA.shared).toBe(ctxB.shared);
  });

  it('drains file cleanups in LIFO order', async () => {
    const order: string[] = [];
    const fixtures = normalizeBuilderFixture(
      'a',
      { scope: 'file' },
      async (_, { onCleanup }) => {
        onCleanup(() => order.push('a-1'));
        onCleanup(() => order.push('a-2'));
        return 1;
      },
    );
    const store = createFileFixtureStore();
    await handleFixtures(
      makeTestCase(fixtures, ({ a }: any) => a),
      {},
      store,
    );

    const errors = await flushFileFixtures(store);
    expect(errors).toEqual([]);
    // onCleanup handlers run LIFO: last registered first.
    expect(order).toEqual(['a-2', 'a-1']);
  });
});
