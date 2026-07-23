import { describe, expect, it } from '@rstest/core';
import {
  createFixtureResolver,
  normalizeFixtures,
} from '../../../src/runtime/runner/fixtures';

describe('normalizeFixtures', () => {
  it('treats a single-function tuple as a fixture function', () => {
    const fixtureFn = () => {};
    const result = normalizeFixtures({ a: [fixtureFn] } as any);
    expect(result.a).toMatchObject({ isFn: true, value: fixtureFn });
  });

  it('parses the [value, options] tuple form', () => {
    const result = normalizeFixtures({ a: ['x', { auto: true }] } as any);
    expect(result.a).toMatchObject({
      isFn: false,
      value: 'x',
      options: { auto: true },
    });
  });

  it('wraps a plain value as a non-function fixture', () => {
    const result = normalizeFixtures({ a: 42 } as any);
    expect(result.a).toMatchObject({ isFn: false, value: 42 });
  });

  it('computes deps only for fixtures that exist in the set', () => {
    const aFn = ({ b }: any) => b;
    const result = normalizeFixtures({ a: [aFn], b: 1, c: 2 } as any);
    expect(result.a.deps).toEqual(['b']);
  });

  it('merges extendFixtures with local fixtures taking precedence', () => {
    const extend = { base: { isFn: false, value: 'base' } } as any;
    const result = normalizeFixtures({ a: 1 } as any, extend);
    expect(result.base).toEqual({ isFn: false, value: 'base' });
    expect(result.a).toMatchObject({ isFn: false, value: 1 });
  });
});

describe('normalizeFixtures param parsing (getFixtureUsedProps)', () => {
  it('skips dependency detection for an _-prefixed first param', () => {
    const fixtureFn = (_ctx: any) => {};
    const result = normalizeFixtures({ a: [fixtureFn] } as any);
    expect(result.a.deps).toEqual([]);
  });

  it('throws when the first param is not destructured', () => {
    const fixtureFn = (ctx: any) => ctx;
    expect(() => normalizeFixtures({ a: [fixtureFn] } as any)).toThrow(
      /object destructuring pattern/,
    );
  });

  it('throws when a rest property is used', () => {
    const fixtureFn = ({ ...rest }: any) => rest;
    expect(() => normalizeFixtures({ a: [fixtureFn] } as any)).toThrow(
      /Rest property/,
    );
  });

  it('strips comments before parsing the destructured params', () => {
    const useFn = ({ foo /* inline */, bar }: any) => [foo, bar];
    const result = normalizeFixtures({
      used: [useFn],
      foo: 1,
      bar: 2,
    } as any);
    expect([...(result.used.deps ?? [])].sort()).toEqual(['bar', 'foo']);
  });

  it('detects destructuring moved into the body by a compiler', () => {
    const useFn = (param: { foo: number; bar: number }) => {
      const { foo, bar: renamedBar } = param;
      return [foo, renamedBar];
    };
    const result = normalizeFixtures({
      used: [useFn],
      foo: 1,
      bar: 2,
    } as any);

    expect([...(result.used.deps ?? [])].sort()).toEqual(['bar', 'foo']);
  });

  it('detects compiler-moved destructuring for an unparenthesized arrow', () => {
    const useFn = Object.assign(() => {}, {
      toString: () =>
        'param => { const { foo, bar: renamedBar } = param; return [foo, renamedBar]; }',
    });
    const result = normalizeFixtures({
      used: [useFn],
      foo: 1,
      bar: 2,
    } as any);

    expect([...(result.used.deps ?? [])].sort()).toEqual(['bar', 'foo']);
  });

  it('ignores destructuring text inside strings', () => {
    const useFn = (context: unknown) => `const { foo } = context`;

    expect(() => normalizeFixtures({ used: [useFn], foo: 1 } as any)).toThrow(
      /object destructuring pattern/,
    );
  });
});

describe('createFixtureResolver', () => {
  it('does not parse callbacks when the test has no fixtures', async () => {
    const resolver = createFixtureResolver({} as any, {});

    await expect(
      resolver.resolveTestFixtures((context: unknown) => context),
    ).resolves.toBeUndefined();
  });

  it('allows named hook contexts when the test has fixtures', async () => {
    const fixtures = normalizeFixtures({ fixture: 1 } as any);
    const resolver = createFixtureResolver({ fixtures } as any, {});

    await expect(
      resolver.resolveHookFixtures((context: unknown) => context),
    ).resolves.toBeUndefined();
  });

  it('collects fixtures from every named hook context destructuring', async () => {
    const context = { task: 'task' };
    const fixtures = normalizeFixtures({ fixture: 'fixture' } as any);
    const resolver = createFixtureResolver({ fixtures } as any, context);

    await resolver.resolveHookFixtures((ctx: any) => {
      const { task } = ctx;
      const { fixture } = ctx;
      return [task, fixture];
    });

    expect(context).toEqual({ task: 'task', fixture: 'fixture' });
  });

  it('finds named context destructuring after strings with comment tokens', async () => {
    const context: Record<string, any> = {};
    const fixtures = normalizeFixtures({ fixture: 'fixture' } as any);
    const resolver = createFixtureResolver({ fixtures } as any, context);
    const hook = Object.assign(() => {}, {
      toString: () =>
        "(ctx) => { const url = 'http://localhost'; const { fixture } = ctx; }",
    });

    await resolver.resolveHookFixtures(hook);

    expect(context.fixture).toBe('fixture');
  });

  it('finds named context destructuring after comments with quotes', async () => {
    const context: Record<string, any> = {};
    const fixtures = normalizeFixtures({ fixture: 'fixture' } as any);
    const resolver = createFixtureResolver({ fixtures } as any, context);
    const hook = Object.assign(() => {}, {
      toString: () => `(ctx) => {
        // don't hide fixtures
        const { fixture } = ctx;
      }`,
    });

    await resolver.resolveHookFixtures(hook);

    expect(context.fixture).toBe('fixture');
  });

  it('does not collect named context destructuring from nested functions', async () => {
    const context: Record<string, any> = {};
    const fixtures = normalizeFixtures({
      beforeValue: 'before',
      arrowCleanupValue: 'arrow cleanup',
      functionCleanupValue: 'function cleanup',
    } as any);
    const resolver = createFixtureResolver({ fixtures } as any, context);
    const hook = Object.assign(() => {}, {
      toString: () =>
        '(ctx) => { if (true) { const { beforeValue } = ctx; } const cleanup = (ctx) => { const { arrowCleanupValue } = ctx; }; return function (ctx) { const { functionCleanupValue } = ctx; }; }',
    });

    await resolver.resolveHookFixtures(hook);

    expect(context).toEqual({ beforeValue: 'before' });
  });

  it('parses balanced named context destructuring', async () => {
    const context: Record<string, any> = {};
    const fixtures = normalizeFixtures({
      options: { baseURL: 'http://localhost' },
      settings: { mode: 'fixture' },
      page: 'page',
    } as any);
    const resolver = createFixtureResolver({ fixtures } as any, context);
    const hook = Object.assign(() => {}, {
      toString: () =>
        "(ctx) => { const { options: { baseURL }, settings = { mode: 'default' }, page } = ctx; }",
    });

    await resolver.resolveHookFixtures(hook);

    expect(context).toEqual({
      options: { baseURL: 'http://localhost' },
      settings: { mode: 'fixture' },
      page: 'page',
    });
  });

  it('activates auto and requested test fixtures', async () => {
    const order: string[] = [];
    const fixtures = normalizeFixtures({
      autoFix: [
        async (_ctx: any, use: any) => {
          order.push('auto');
          await use('A');
        },
        { auto: true },
      ],
      usedFix: [
        async (_ctx: any, use: any) => {
          order.push('used');
          await use('U');
        },
      ],
      unusedFix: [
        async (_ctx: any, use: any) => {
          order.push('unused');
          await use('X');
        },
      ],
    } as any);

    const context: Record<string, any> = {};
    const test = {
      fixtures,
    } as any;
    const cleanups: (() => Promise<void>)[] = [];
    const resolver = createFixtureResolver(test, context, cleanups);

    await resolver.resolveTestFixtures(({ usedFix }: any) => usedFix);

    expect(context.autoFix).toBe('A');
    expect(context.usedFix).toBe('U');
    expect('unusedFix' in context).toBe(false);
    expect(order).toEqual(['auto', 'used']);
    expect(cleanups).toHaveLength(2);
  });

  it('shares fixture instances across hook and test callbacks', async () => {
    const setups: string[] = [];
    const fixtures = normalizeFixtures({
      shared: [
        async (_ctx: any, use: any) => {
          setups.push('shared');
          await use('value');
        },
      ],
    } as any);
    const context: Record<string, any> = {};
    const resolver = createFixtureResolver({ fixtures } as any, context);

    await resolver.resolveTestFixtures(({ shared }: any) => shared);
    await resolver.resolveHookFixtures(({ shared }: any) => shared);

    expect(context.shared).toBe('value');
    expect(setups).toEqual(['shared']);
  });

  it('throws on circular fixture dependencies', async () => {
    const fixtures = normalizeFixtures({
      x: [async ({ y }: any, use: any) => use(y)],
      y: [async ({ x }: any, use: any) => use(x)],
    } as any);

    const test = {
      fixtures,
    } as any;
    const resolver = createFixtureResolver(test, {});

    await expect(
      resolver.resolveTestFixtures(({ x }: any) => x),
    ).rejects.toThrow(/Circular fixture dependency/);
  });

  it('does not retry fixtures after setup failures', async () => {
    let setupAttempts = 0;
    const fixtures = normalizeFixtures({
      failing: [
        async () => {
          setupAttempts++;
          throw new Error('fixture setup failed');
        },
      ],
    } as any);
    const resolver = createFixtureResolver({ fixtures } as any, {});

    await expect(
      resolver.resolveTestFixtures(({ failing }: any) => failing),
    ).rejects.toThrow('fixture setup failed');
    await expect(
      resolver.resolveHookFixtures(({ failing }: any) => failing),
    ).resolves.toBe(false);

    expect(setupAttempts).toBe(1);
  });

  it('registers cleanups in reverse (unshift) order', async () => {
    const cleaned: string[] = [];
    const fixtures = normalizeFixtures({
      first: [
        async (_c: any, use: any) => {
          await use(1);
          cleaned.push('first');
        },
        { auto: true },
      ],
      second: [
        async (_c: any, use: any) => {
          await use(2);
          cleaned.push('second');
        },
        { auto: true },
      ],
    } as any);

    const test = {
      fixtures,
    } as any;
    const cleanups: (() => Promise<void>)[] = [];
    const resolver = createFixtureResolver(test, {}, cleanups);

    await resolver.resolveTestFixtures();
    for (const cleanup of cleanups) {
      await cleanup();
    }
    expect(cleaned).toEqual(['second', 'first']);
  });
});
