import { describe, expect, it } from '@rstest/core';
import {
  createFixtureResolver,
  FixtureScopeManager,
  normalizeBuilderFixture,
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
    expect(result.a!.deps).toEqual(['b']);
  });

  it('merges extendFixtures with local fixtures taking precedence', () => {
    const extend = normalizeFixtures({ base: 'base' } as any);
    const result = normalizeFixtures({ a: 1 } as any, extend);
    expect(result.base).toMatchObject({ isFn: false, value: 'base' });
    expect(result.a).toMatchObject({ isFn: false, value: 1 });
  });

  it('does not mutate inherited fixture dependencies', () => {
    const base = normalizeFixtures({
      base: async ({ addedLater }: any, use: any) => {
        await use(addedLater);
      },
    } as any);

    normalizeFixtures({ addedLater: 1 } as any, base);

    expect(base.base?.deps).toEqual([]);
  });
});

describe('normalizeFixtures param parsing (getFixtureUsedProps)', () => {
  it('skips dependency detection for an _-prefixed first param', () => {
    const fixtureFn = (_ctx: any) => {};
    const result = normalizeFixtures({ a: [fixtureFn] } as any);
    expect(result.a!.deps).toEqual([]);
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

  it('throws when a destructured fixture has a default value', () => {
    const fixtureFn = Object.assign(() => {}, {
      toString: () => '({ value = "default" }, use) => use(value)',
    });
    expect(() =>
      normalizeFixtures({ a: [fixtureFn], value: 1 } as any),
    ).toThrow(/Default values are not supported/);
  });

  it('throws when the fixture context has a default value', () => {
    const fixtureFn = Object.assign(() => {}, {
      toString: () => '({ value } = {}, use) => use(value)',
    });
    expect(() =>
      normalizeFixtures({ a: [fixtureFn], value: 1 } as any),
    ).toThrow(/Default values are not supported/);
  });

  it('parses comments and aliases in destructured params', () => {
    const useFn = ({ foo /* inline */, bar: renamedBar }: any) => [
      foo,
      renamedBar,
    ];
    const result = normalizeFixtures({
      used: [useFn],
      foo: 1,
      bar: 2,
    } as any);
    expect([...(result.used!.deps ?? [])].sort()).toEqual(['bar', 'foo']);
  });
});

describe('scoped fixtures', () => {
  it('validates dependency direction', () => {
    const testValue = normalizeBuilderFixture('testValue', 1, {
      scope: 'test',
    });
    expect(() =>
      normalizeBuilderFixture(
        'workerValue',
        ({ testValue }: any) => testValue,
        { scope: 'worker' },
        testValue,
      ),
    ).toThrow(
      'The worker fixture "workerValue" cannot depend on the test fixture "testValue".',
    );

    expect(() =>
      normalizeBuilderFixture('workerValue', ({ task }: any) => task, {
        scope: 'worker',
      }),
    ).toThrow(
      'The worker fixture "workerValue" cannot depend on test context "task".',
    );
  });

  it('requires the builder form for file and worker scopes', () => {
    expect(() =>
      normalizeFixtures({
        workerValue: ['worker', { scope: 'worker' }],
      } as any),
    ).toThrow(
      'Fixture "workerValue" must use test.extend(name, options, fixture) for "worker" scope.',
    );
  });

  it('supports builder fixtures and onCleanup', async () => {
    const events: string[] = [];
    const fixtures = normalizeBuilderFixture(
      'port',
      (_context: object, { onCleanup }: any) => {
        events.push('setup');
        onCleanup(() => {
          events.push('cleanup');
        });
        return 5000;
      },
      { scope: 'worker' },
    );
    const worker = new FixtureScopeManager('worker');
    const resolver = createFixtureResolver({ fixtures } as any, {}, [], {
      file: new FixtureScopeManager('file'),
      worker,
    });

    await resolver.resolveTestFixtures(({ port }: any) => port);
    await worker.cleanup();

    expect(events).toEqual(['setup', 'cleanup']);
  });

  it('shares file and worker fixtures at their lifecycle boundaries', async () => {
    const events: string[] = [];
    const workerFixtures = normalizeBuilderFixture(
      'workerValue',
      (_context: object, { onCleanup }: any) => {
        events.push('worker:setup');
        onCleanup(() => {
          events.push('worker:cleanup');
        });
        return 'worker';
      },
      { scope: 'worker' },
    );
    const fileFixtures = normalizeBuilderFixture(
      'fileValue',
      ({ workerValue }: any, { onCleanup }: any) => {
        events.push(`file:setup:${workerValue}`);
        onCleanup(() => {
          events.push('file:cleanup');
        });
        return 'file';
      },
      { scope: 'file' },
      workerFixtures,
    );
    const fixtures = normalizeBuilderFixture(
      'testValue',
      ({ fileValue }: any, { onCleanup }: any) => {
        events.push(`test:setup:${fileValue}`);
        onCleanup(() => {
          events.push('test:cleanup');
        });
        return 'test';
      },
      { scope: 'test' },
      fileFixtures,
    );
    const file = new FixtureScopeManager('file');
    const worker = new FixtureScopeManager('worker');

    for (let index = 0; index < 2; index++) {
      const cleanups: (() => Promise<void>)[] = [];
      const resolver = createFixtureResolver(
        { fixtures } as any,
        {},
        cleanups,
        { file, worker },
      );
      await resolver.resolveTestFixtures(({ testValue }: any) => testValue);
      for (const cleanup of cleanups) {
        await cleanup();
      }
    }

    await file.cleanup();
    await worker.cleanup();

    expect(events).toEqual([
      'worker:setup',
      'file:setup:worker',
      'test:setup:file',
      'test:cleanup',
      'test:setup:file',
      'test:cleanup',
      'file:cleanup',
      'worker:cleanup',
    ]);
  });

  it('initializes a concurrent file fixture once', async () => {
    let setups = 0;
    let continueSetup: (() => void) | undefined;
    const setupPaused = new Promise<void>((resolve) => {
      continueSetup = resolve;
    });
    const fixtures = normalizeBuilderFixture(
      'shared',
      async () => {
        setups++;
        await setupPaused;
        return 'shared';
      },
      { scope: 'file' },
    );
    const file = new FixtureScopeManager('file');
    const worker = new FixtureScopeManager('worker');
    const first = createFixtureResolver({ fixtures } as any, {}, [], {
      file,
      worker,
    });
    const second = createFixtureResolver({ fixtures } as any, {}, [], {
      file,
      worker,
    });

    const resolutions = [
      first.resolveTestFixtures(({ shared }: any) => shared),
      second.resolveTestFixtures(({ shared }: any) => shared),
    ];
    await Promise.resolve();
    continueSetup!();
    await Promise.all(resolutions);
    await file.cleanup();

    expect(setups).toBe(1);
  });

  it('separates scoped instances when an effective dependency changes', async () => {
    const dependency = normalizeBuilderFixture('dependency', 'base', {
      scope: 'worker',
    });
    const baseFixtures = normalizeBuilderFixture(
      'derived',
      ({ dependency }: { dependency: string }) => dependency,
      { scope: 'worker' },
      dependency,
    );
    const childFixtures = normalizeBuilderFixture(
      'dependency',
      'child',
      { scope: 'worker' },
      baseFixtures,
    );
    const worker = new FixtureScopeManager('worker');
    const managers = {
      file: new FixtureScopeManager('file'),
      worker,
    };
    const baseContext: Record<string, unknown> = {};
    const childContext: Record<string, unknown> = {};

    await createFixtureResolver(
      { fixtures: baseFixtures } as any,
      baseContext,
      [],
      managers,
    ).resolveTestFixtures(({ derived }: any) => derived);
    await createFixtureResolver(
      { fixtures: childFixtures } as any,
      childContext,
      [],
      managers,
    ).resolveTestFixtures(({ derived }: any) => derived);
    await worker.cleanup();

    expect(baseContext.derived).toBe('base');
    expect(childContext.derived).toBe('child');
  });

  it('does not retain unrelated values in scoped setup contexts', async () => {
    let inspectedKeys: string[] = [];
    const fixtures = normalizeBuilderFixture('first', () => 'first', {
      scope: 'worker',
    });
    const extendedFixtures = normalizeBuilderFixture(
      'inspector',
      (_context: object) => {
        inspectedKeys = Object.keys(_context);
        return 'inspector';
      },
      { scope: 'worker' },
      fixtures,
    );
    const worker = new FixtureScopeManager('worker');
    const managers = {
      file: new FixtureScopeManager('file'),
      worker,
    };

    await createFixtureResolver(
      { fixtures: extendedFixtures } as any,
      {},
      [],
      managers,
    ).resolveTestFixtures(({ first }: any) => first);
    await createFixtureResolver(
      { fixtures: extendedFixtures } as any,
      {},
      [],
      managers,
    ).resolveTestFixtures(({ inspector }: any) => inspector);
    await worker.cleanup();

    expect(inspectedKeys).toEqual([]);
  });

  it('releases scoped instances when cleanup fails', async () => {
    let setups = 0;
    const fixtures = normalizeBuilderFixture(
      'value',
      (_context: object, { onCleanup }: any) => {
        setups++;
        onCleanup(() => {
          throw new Error('cleanup failed');
        });
        return setups;
      },
      { scope: 'worker' },
    );
    const worker = new FixtureScopeManager('worker');
    const managers = {
      file: new FixtureScopeManager('file'),
      worker,
    };

    const resolveValue = () =>
      createFixtureResolver(
        { fixtures } as any,
        {},
        [],
        managers,
      ).resolveTestFixtures(({ value }: any) => value);

    await expect(resolveValue()).resolves.toBeUndefined();
    await expect(worker.cleanup()).rejects.toThrow('cleanup failed');
    await expect(resolveValue()).resolves.toBeUndefined();

    expect(setups).toBe(2);
  });
});

describe('createFixtureResolver', () => {
  it('does not parse callbacks when the test has no fixtures', async () => {
    const resolver = createFixtureResolver({} as any, {});

    await expect(
      resolver.resolveTestFixtures((context: unknown) => context),
    ).resolves.toBeUndefined();
  });

  it('allows named hook contexts without inferring fixture dependencies', async () => {
    let setupAttempts = 0;
    const context = { task: { name: 'test' } };
    const fixtures = normalizeFixtures({
      page: [
        async (_context: any, use: any) => {
          setupAttempts++;
          await use('page');
        },
      ],
    } as any);
    const resolver = createFixtureResolver({ fixtures } as any, context);

    await resolver.resolveHookFixtures((hookContext: any) => {
      const { page } = hookContext;
      for (const hookContext of [{ page: 'local' }]) {
        expect(hookContext.page).toBe('local');
      }
      return [hookContext.task.name, page];
    });

    expect(setupAttempts).toBe(0);
    expect(context).toEqual({ task: { name: 'test' } });
  });

  it('allows TestContext properties in destructured hooks', async () => {
    const context = Object.assign(() => {}, { task: { name: 'test' } });
    const resolver = createFixtureResolver({} as any, context);

    await expect(
      resolver.resolveHookFixtures(({ task }: any) => task.name),
    ).resolves.toEqual({ status: 'resolved' });
  });

  it('does not treat Function properties as TestContext properties', async () => {
    const context = Object.assign(() => {}, { task: { name: 'test' } });
    const resolver = createFixtureResolver({} as any, context);

    await expect(
      resolver.resolveHookFixtures(({ name }: any) => name),
    ).rejects.toThrow('Hook has unknown fixture "name"');
  });

  it('rejects hook fixtures missing from the current test', async () => {
    const resolver = createFixtureResolver({} as any, {
      task: { name: 'plain test' },
    });

    await expect(
      resolver.resolveHookFixtures(({ custom }: any) => custom),
    ).rejects.toThrow(
      'Hook has unknown fixture "custom". Every test in the hook\'s suite must provide it.',
    );
  });

  it('validates all hook fixtures before starting requested fixture setup', async () => {
    let setupAttempts = 0;
    const fixtures = normalizeFixtures({
      available: [
        async (_context: any, use: any) => {
          setupAttempts++;
          await use('available');
        },
      ],
    } as any);
    const resolver = createFixtureResolver({ fixtures } as any, {
      task: { name: 'test' },
    });

    await expect(
      resolver.resolveHookFixtures(
        ({ available, missing }: any) => available ?? missing,
      ),
    ).rejects.toThrow('Hook has unknown fixture "missing"');
    expect(setupAttempts).toBe(0);
  });

  it('resolves fixtures directly destructured by hooks', async () => {
    const context: Record<string, any> = {};
    const fixtures = normalizeFixtures({ fixture: 'fixture' } as any);
    const resolver = createFixtureResolver({ fixtures } as any, context);

    await resolver.resolveHookFixtures(({ fixture }: any) => fixture);

    expect(context.fixture).toBe('fixture');
  });

  it('rejects rest properties in destructured hook parameters', async () => {
    const fixtures = normalizeFixtures({ fixture: 'fixture' } as any);
    const resolver = createFixtureResolver({ fixtures } as any, {});

    await expect(
      resolver.resolveHookFixtures(({ fixture, ...rest }: any) => [
        fixture,
        rest,
      ]),
    ).rejects.toThrow(/Rest property/);
  });

  it('rejects defaults instead of partially resolving fixture names', async () => {
    const fixtures = normalizeFixtures({
      title: 'title',
      page: 'page',
    } as any);
    const resolver = createFixtureResolver({ fixtures } as any, {});

    const propertyDefault = Object.assign(() => {}, {
      toString: () => '({ title = "🔒", page }) => page',
    });
    await expect(resolver.resolveHookFixtures(propertyDefault)).rejects.toThrow(
      /Default values are not supported/,
    );

    const contextDefault = Object.assign(() => {}, {
      toString: () => '({ page } = {}) => page',
    });
    await expect(resolver.resolveHookFixtures(contextDefault)).rejects.toThrow(
      /Default values are not supported/,
    );
  });

  it('caches parsed fixture props across test attempts', async () => {
    let parseCalls = 0;
    const context: Record<string, any> = {};
    const fixtures = normalizeFixtures({ fixture: 'fixture' } as any);
    const resolver = createFixtureResolver({ fixtures } as any, context);
    const hook = Object.assign(() => {}, {
      toString: () => {
        parseCalls++;
        return '({ fixture }) => fixture';
      },
    });

    await resolver.resolveHookFixtures(hook);
    await resolver.resolveHookFixtures(hook);

    expect(parseCalls).toBe(1);
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
    ).resolves.toEqual({ status: 'skipped' });

    expect(setupAttempts).toBe(1);
  });

  it('tears down fixture setup that finishes after cancellation', async () => {
    const events: string[] = [];
    let continueSetup: (() => void) | undefined;
    let continueTeardown: (() => void) | undefined;
    const setupPaused = new Promise<void>((resolve) => {
      continueSetup = resolve;
    });
    const teardownPaused = new Promise<void>((resolve) => {
      continueTeardown = resolve;
    });
    let teardownStarted: (() => void) | undefined;
    const teardownStartedPromise = new Promise<void>((resolve) => {
      teardownStarted = resolve;
    });
    const fixtures = normalizeFixtures({
      slow: [
        async (_context: any, use: any) => {
          await setupPaused;
          events.push('setup');
          await use('slow');
          events.push('teardown:start');
          teardownStarted!();
          await teardownPaused;
          events.push('teardown');
        },
      ],
    } as any);
    const context: Record<string, any> = {};
    const cleanups: (() => Promise<void>)[] = [];
    const resolver = createFixtureResolver(
      { fixtures } as any,
      context,
      cleanups,
    );

    const resolution = resolver.resolveHookFixtures(({ slow }: any) => slow);
    await Promise.resolve();
    const cancellation = resolver.cancelPendingFixtures();
    continueSetup!();

    await expect(cancellation?.teardownStarted).resolves.toBeUndefined();
    await teardownStartedPromise;
    const resolutionSettled = await Promise.race([
      resolution.then(() => true),
      new Promise<false>((resolve) => {
        setImmediate(() => resolve(false));
      }),
    ]);

    expect(resolutionSettled).toBe(false);
    continueTeardown!();
    await expect(resolution).resolves.toEqual({ status: 'skipped' });
    expect(events).toEqual(['setup', 'teardown:start', 'teardown']);
    expect(context).toEqual({});
    expect(cleanups).toEqual([]);
  });

  it('settles a cancelled fixture that returns without calling use', async () => {
    let continueSetup: (() => void) | undefined;
    const setupPaused = new Promise<void>((resolve) => {
      continueSetup = resolve;
    });
    const fixtures = normalizeFixtures({
      slow: [
        async () => {
          await setupPaused;
        },
      ],
    } as any);
    const resolver = createFixtureResolver({ fixtures } as any, {});

    const resolution = resolver.resolveHookFixtures(({ slow }: any) => slow);
    await Promise.resolve();
    resolver.cancelPendingFixtures();
    continueSetup!();

    const resolutionSettled = await Promise.race([
      resolution.then(() => true),
      new Promise<false>((resolve) => {
        setImmediate(() => resolve(false));
      }),
    ]);

    expect(resolutionSettled).toBe(true);
    await expect(resolution).resolves.toEqual({ status: 'skipped' });
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
