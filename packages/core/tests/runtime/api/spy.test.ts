import { runInNewContext } from 'node:vm';
import { describe, expect, it } from '@rstest/core';
import { spies as tinyspySpies } from 'tinyspy';
import { initSpy } from '../../../src/runtime/api/spy';

describe('initSpy fn()', () => {
  it('keeps its mocks out of the strong tinyspy restore registry', () => {
    const { fn, spyOn } = initSpy();
    const initialSize = tinyspySpies.size;
    fn();
    const target = { method: () => 1 };
    spyOn(target, 'method');
    expect(tinyspySpies.size).toBe(initialSize);
  });

  it('creates mocks in the supplied VM realm', () => {
    const context = runInNewContext('globalThis', {}) as Record<
      string,
      unknown
    >;
    const { fn } = initSpy(
      () => '',
      () => context,
    );
    const mock = fn();
    const isVmFunction = runInNewContext(
      '(value) => value instanceof Function',
      context,
    ) as (value: unknown) => boolean;
    const isVmObject = runInNewContext(
      '(value) => value instanceof Object',
      context,
    ) as (value: unknown) => boolean;

    expect(isVmFunction(mock)).toBe(true);
    expect(isVmObject(new mock())).toBe(true);
  });

  it('reuses the wrapper factory when returning to a VM realm', () => {
    const first: typeof globalThis = runInNewContext('globalThis');
    const second: typeof globalThis = runInNewContext('globalThis');
    let compilations = 0;
    first.Function = new Proxy(first.Function, {
      apply(target, receiver, args) {
        compilations++;
        return Reflect.apply(target, receiver, args);
      },
    });
    let realm = first;
    const { fn } = initSpy(
      () => '',
      () => realm,
    );
    const a = fn();
    realm = second;
    const b = fn();
    realm = first;
    const c = fn();

    expect(compilations).toBe(1);
    expect(a).toBeInstanceOf(first.Function);
    expect(b).toBeInstanceOf(second.Function);
    expect(c).toBeInstanceOf(first.Function);
    expect(c.prototype).not.toBe(a.prototype);
    expect(c.mockName('third')).toBe(c);
    expect(a.getMockName()).not.toBe('third');
  });

  it('installs mock helpers with the public mock as the setter receiver', () => {
    const original = () => 42;
    const installed = new WeakMap<object, unknown>();
    Object.defineProperty(original, 'mockName', {
      get() {
        return installed.get(this);
      },
      set(value: unknown) {
        installed.set(this, value);
      },
    });
    const mock = initSpy().fn(original);

    expect(installed.has(mock)).toBe(true);
    expect(mock.mockName('renamed')).toBe(mock);
    expect(mock.getMockName()).toBe('renamed');
  });

  it('creates resolved and rejected values in the supplied VM realm', async () => {
    const context = runInNewContext('globalThis', {}) as Record<
      string,
      unknown
    >;
    const { fn } = initSpy(
      () => '',
      () => context,
    );
    const isVmPromise = runInNewContext(
      '(value) => value instanceof Promise',
      context,
    ) as (value: unknown) => boolean;

    const resolved = fn().mockResolvedValue('value')();
    expect(isVmPromise(resolved)).toBe(true);
    await expect(resolved).resolves.toBe('value');

    const rejected = fn().mockRejectedValue('error')();
    expect(isVmPromise(rejected)).toBe(true);
    await expect(rejected).rejects.toBe('error');
  });

  it('exposes mock state collections in the supplied VM realm', () => {
    const context = runInNewContext('globalThis', {}) as Record<
      string,
      unknown
    >;
    const { fn } = initSpy(
      () => '',
      () => context,
    );
    const mock = fn((value: string) => value);
    mock('value');

    const check = (
      runInNewContext(
        `(mock) => ({
        calls: mock.mock.calls instanceof Array,
        call: mock.mock.calls[0] instanceof Array,
        instances: mock.mock.instances instanceof Array,
        contexts: mock.mock.contexts instanceof Array,
        invocationCallOrder: mock.mock.invocationCallOrder instanceof Array,
        results: mock.mock.results instanceof Array,
        result: mock.mock.results[0] instanceof Object,
        settledResults: mock.mock.settledResults instanceof Array,
      })`,
        context,
      ) as (mockValue: unknown) => Record<string, boolean>
    )(mock);

    expect(check).toEqual({
      calls: true,
      call: true,
      instances: true,
      contexts: true,
      invocationCallOrder: true,
      results: true,
      result: true,
      settledResults: true,
    });
  });

  it('installs and reuses the VM-realm spy for a spied method', () => {
    const context = runInNewContext('globalThis', {}) as Record<
      string,
      unknown
    >;
    const { spyOn } = initSpy(
      () => '',
      () => context,
    );
    const object = {
      method: () => 'value',
    };
    const original = object.method;
    const isVmFunction = runInNewContext(
      '(value) => value instanceof Function',
      context,
    ) as (value: unknown) => boolean;

    const spy = spyOn(object, 'method');

    expect(object.method).toBe(spy);
    expect(isVmFunction(object.method)).toBe(true);
    expect(spyOn(object, 'method')).toBe(spy);
    expect(object.method()).toBe('value');

    spy.mockRestore();
    expect(object.method).toBe(original);
  });

  it('installs a VM-realm spy for an accessor-backed method', () => {
    const context = runInNewContext('globalThis', {}) as Record<
      string,
      unknown
    >;
    const { spyOn } = initSpy(
      () => '',
      () => context,
    );
    const original = () => 'real';
    const object = {} as { method: () => string };
    Object.defineProperty(object, 'method', {
      configurable: true,
      enumerable: true,
      get: () => original,
    });

    const spy = spyOn(object, 'method').mockReturnValue('mocked');

    expect(object.method()).toBe('mocked');
    spy.mockRestore();
    expect(object.method).toBe(original);
  });

  it('tracks calls, results and invocationCallOrder', () => {
    const { fn } = initSpy();
    const spy = fn((x: number) => x * 2);

    expect(spy(2)).toBe(4);
    expect(spy(3)).toBe(6);

    expect(spy.mock.calls).toEqual([[2], [3]]);
    expect(spy.mock.results).toEqual([
      { type: 'return', value: 4 },
      { type: 'return', value: 6 },
    ]);
    expect(spy.mock.invocationCallOrder).toHaveLength(2);
    expect(spy.mock.invocationCallOrder[0]!).toBeLessThan(
      spy.mock.invocationCallOrder[1]!,
    );
  });

  it('records throwing results', () => {
    const { fn } = initSpy();
    const spy = fn(() => {
      throw new Error('boom');
    });

    expect(() => spy()).toThrow('boom');
    expect(spy.mock.results[0]!.type).toBe('throw');
  });

  it('keeps results in call order when a mock calls itself', () => {
    const { fn } = initSpy();
    const typesDuringCalls: string[][] = [];
    const depth = fn((n: number): number => {
      typesDuringCalls.push(depth.mock.results.map(({ type }) => type));
      return n > 0 ? depth(n - 1) + 1 : 0;
    });
    const thrower = fn((n: number) => {
      if (n === 0) throw new Error('inner');
      expect(() => thrower(n - 1)).toThrow('inner');
      return 'outer';
    });

    expect(depth(2)).toBe(2);
    expect(thrower(1)).toBe('outer');

    expect(depth.mock.calls).toEqual([[2], [1], [0]]);
    expect(depth.mock.results).toEqual([
      { type: 'return', value: 2 },
      { type: 'return', value: 1 },
      { type: 'return', value: 0 },
    ]);
    expect(typesDuringCalls).toEqual([
      ['incomplete'],
      ['incomplete', 'incomplete'],
      ['incomplete', 'incomplete', 'incomplete'],
    ]);
    expect(thrower.mock.results).toEqual([
      { type: 'return', value: 'outer' },
      { type: 'throw', value: new Error('inner') },
    ]);
  });

  it('keeps settled results in call order when an async mock calls itself', async () => {
    const { fn } = initSpy();
    const depth = fn(async (n: number): Promise<number> =>
      n > 0 ? (await depth(n - 1)) + 1 : 0,
    );

    await expect(depth(2)).resolves.toBe(2);

    expect(depth.mock.settledResults).toEqual([
      { type: 'fulfilled', value: 2 },
      { type: 'fulfilled', value: 1 },
      { type: 'fulfilled', value: 0 },
    ]);
  });

  it('records settled results of a promise with a custom string tag', async () => {
    class TaggedPromise<T> extends Promise<T> {
      override get [Symbol.toStringTag]() {
        return 'TaggedPromise';
      }
    }
    const { fn } = initSpy();
    const spy = fn(() => TaggedPromise.resolve('ok'));

    await spy();

    expect(spy.mock.settledResults).toEqual([
      { type: 'fulfilled', value: 'ok' },
    ]);
  });

  it('observes a returned Promise only once', async () => {
    const { fn, spyOn } = initSpy();
    const promise = Promise.resolve('ok');
    const then = spyOn(promise, 'then');
    const mock = fn(() => promise);

    expect(mock()).toBe(promise);
    expect(then).toHaveBeenCalledTimes(1);
    await promise;
    expect(mock.mock.settledResults).toEqual([
      { type: 'fulfilled', value: 'ok' },
    ]);
  });

  it.each(['tag', 'then getter', 'then call'])(
    'records a throw when the Promise %s throws',
    (stage) => {
      const { fn } = initSpy();
      const error = new Error(stage);
      const result = {
        get [Symbol.toStringTag]() {
          if (stage === 'tag') throw error;
          return 'Promise';
        },
        get then() {
          if (stage === 'then getter') throw error;
          return () => {
            throw error;
          };
        },
      };
      const mock = fn(() => result);

      expect(mock).toThrow(error);
      expect(mock.mock.results).toEqual([{ type: 'throw', value: error }]);
      expect(mock).not.toHaveReturned();
    },
  );

  it.each(['single', 'project'] as const)(
    'keeps pending results out of a cleared mock (%s)',
    async (scope) => {
      const { fn, clearAllMocks } = initSpy();
      let resolve!: (value: string) => void;
      const promise = new Promise<string>((done) => {
        resolve = done;
      });
      const mock = fn(() => promise);

      mock();
      if (scope === 'single') mock.mockClear();
      else clearAllMocks();
      mock.mockResolvedValueOnce('new');
      await mock();
      resolve('old');
      await promise;

      expect(mock.mock.calls).toEqual([[]]);
      expect(mock.mock.settledResults).toEqual([
        { type: 'fulfilled', value: 'new' },
      ]);
    },
  );

  it('preserves constructor prototypes behind a getter', () => {
    const { spyOn } = initSpy();
    function Original(this: { value: number }, value: number) {
      this.value = value;
    }
    Original.prototype.getValue = function () {
      return this.value;
    };
    const object = {
      get Original() {
        return Original;
      },
    };
    const mock = spyOn(object, 'Original');

    expect(object.Original).toBe(mock);
    const instance = Reflect.construct(object.Original, [42]);

    expect(instance).toBeInstanceOf(Original);
    expect(instance.getValue()).toBe(42);
    expect(mock.mock.results[0]?.value).toBe(instance);
    mock.mockRestore();
    expect(object.Original).toBe(Original);
  });

  it('records the instance as the result of a `new` call', () => {
    const { fn } = initSpy();
    const Mock = fn(function (this: { value?: number }) {
      this.value = 1;
    });

    const instance = new Mock();

    expect(Mock.mock.results).toEqual([{ type: 'return', value: instance }]);
    expect(Mock.mock.results[0]!.value).toBe(instance);
  });

  it('supports permanent and one-time throwing implementations', () => {
    const { fn } = initSpy();
    const spy = fn(() => 'default')
      .mockThrow('permanent')
      .mockThrowOnce('once');

    expect(() => spy()).toThrow('once');
    expect(() => spy()).toThrow('permanent');
    expect(spy.mock.results).toEqual([
      { type: 'throw', value: 'once' },
      { type: 'throw', value: 'permanent' },
    ]);
  });

  it('isMockFunction distinguishes mocks from plain values', () => {
    const { fn, isMockFunction } = initSpy();
    expect(isMockFunction(fn())).toBe(true);
    expect(isMockFunction(() => {})).toBe(false);
    expect(isMockFunction(null)).toBe(false);
  });
});

describe('initSpy once-implementation queue (LIFO-peek vs FIFO-consume)', () => {
  it('pins the intentional divergence between getMockImplementation and dispatch', () => {
    const { fn } = initSpy();
    const baseImpl = () => 'base';
    const spy = fn(baseImpl);
    const onceA = () => 'A';
    const onceB = () => 'B';

    spy.mockImplementationOnce(onceA);
    spy.mockImplementationOnce(onceB);

    // getMockImplementation peeks the LAST queued once-impl (LIFO, spy.ts:62)...
    expect(spy.getMockImplementation()).toBe(onceB);
    // ...but actual dispatch consumes the FIRST queued once-impl (FIFO, spy.ts:143).
    // The two intentionally disagree — this is pinned, not a bug to "fix".
    expect(spy()).toBe('A');

    // After A is consumed, B is both peeked and dispatched.
    expect(spy.getMockImplementation()).toBe(onceB);
    expect(spy()).toBe('B');

    // Queue drained → falls back to the base implementation.
    expect(spy.getMockImplementation()).toBe(baseImpl);
    expect(spy()).toBe('base');
  });
});

describe('initSpy reset semantics', () => {
  it('mockClear resets call state but keeps the implementation', () => {
    const { fn } = initSpy();
    const spy = fn(() => 'impl');

    expect(spy()).toBe('impl');
    expect(spy.mock.calls).toHaveLength(1);

    spy.mockClear();
    expect(spy.mock.calls).toHaveLength(0);
    expect(spy()).toBe('impl');
  });

  it('mockReset clears the once-queue and restores the base implementation', () => {
    const { fn } = initSpy();
    const spy = fn(() => 'base');

    spy.mockImplementation(() => 'override');
    spy.mockImplementationOnce(() => 'once');
    expect(spy()).toBe('once');

    spy.mockReset();
    expect(spy()).toBe('base');
  });

  it('scopes call history, implementations and spy restoration to the creating project', () => {
    let project = 'A';
    const { fn, spyOn, clearAllMocks, resetAllMocks, restoreAllSpies } =
      initSpy(() => project);
    const mock = fn(() => 'base').mockReturnValue('override');
    const target = { method: () => 'original' };
    const spy = spyOn(target, 'method');
    mock();

    project = 'B';
    const other = fn();
    other();
    clearAllMocks();
    resetAllMocks();
    restoreAllSpies();
    expect(other.mock.calls).toHaveLength(0);
    expect(mock.mock.calls).toHaveLength(1);
    expect(mock()).toBe('override');
    expect(target.method).toBe(spy);

    project = 'A';
    const context = mock.mock;
    mock.mockReturnValueOnce('once');
    clearAllMocks();
    expect(context.calls).toEqual([]);
    expect(mock()).toBe('once');
    expect(mock()).toBe('override');
    mock.mockReturnValueOnce('discard');
    resetAllMocks();
    expect(mock.mock.calls).toEqual([]);
    expect(mock()).toBe('base');
    restoreAllSpies();
    expect(target.method).not.toBe(spy);
  });
});

describe('initSpy withImplementation', () => {
  it('does not reinstall a discarded override when an async scope finishes after reset', async () => {
    const { fn, resetAllMocks } = initSpy();
    const mock = fn(() => 'base').mockReturnValue('old override');
    await mock.withImplementation(
      () => 'temporary',
      async () => {
        expect(mock()).toBe('temporary');
        resetAllMocks();
        await Promise.resolve();
      },
    );
    expect(mock()).toBe('base');
  });

  it('restores the implementation after a synchronous callback throws', () => {
    const { fn } = initSpy();
    const spy = fn(() => 'original');
    spy.mockImplementationOnce(() => 'once');

    expect(() =>
      spy.withImplementation(
        () => 'temporary',
        () => {
          expect(spy()).toBe('temporary');
          throw new Error('sync failure');
        },
      ),
    ).toThrow('sync failure');

    expect(spy()).toBe('once');
    expect(spy()).toBe('original');
  });

  it('restores the implementation after an asynchronous callback rejects', async () => {
    const { fn } = initSpy();
    const spy = fn(() => 'original');
    spy.mockImplementationOnce(() => 'once');

    await expect(
      spy.withImplementation(
        () => 'temporary',
        async () => {
          expect(spy()).toBe('temporary');
          throw new Error('async failure');
        },
      ),
    ).rejects.toThrow('async failure');

    expect(spy()).toBe('once');
    expect(spy()).toBe('original');
  });

  it('keeps the temporary implementation until a cross-realm Promise resolves', async () => {
    const callbackPromise: Promise<void> = runInNewContext('Promise.resolve()');
    expect(callbackPromise).not.toBeInstanceOf(Promise);

    const { fn } = initSpy();
    const spy = fn(() => 'original');
    spy.mockImplementationOnce(() => 'once');

    const withImplReturn = spy.withImplementation(
      () => 'temporary',
      () => callbackPromise,
    );

    expect(spy()).toBe('temporary');
    await withImplReturn;
    expect(spy()).toBe('once');
    expect(spy()).toBe('original');
  });

  it('returns the VM mock after an asynchronous withImplementation callback', async () => {
    const context: typeof globalThis = runInNewContext('globalThis');
    const { fn } = initSpy(
      () => '',
      () => context,
    );
    const spy = fn(() => 'original');

    const result = spy.withImplementation(
      () => 'temporary',
      () => Promise.resolve(),
    );

    expect(result).toBeInstanceOf(context.Promise);
    expect(await result).toBe(spy);
  });
});

describe('initSpy spyOn', () => {
  it('restores spies without resetting mock implementations or call history', () => {
    const { fn, spyOn, restoreAllSpies } = initSpy();
    const mock = fn().mockReturnValue('mocked');
    const object = { method: () => 'original' };
    const spy = spyOn(object, 'method').mockReturnValue('spied');

    expect(mock()).toBe('mocked');
    expect(object.method()).toBe('spied');

    restoreAllSpies();

    expect(mock()).toBe('mocked');
    expect(mock.mock.calls).toEqual([[], []]);
    expect(object.method()).toBe('original');
    expect(spy.mock.calls).toEqual([[]]);

    object.method = () => 'changed';
    restoreAllSpies();
    expect(object.method()).toBe('changed');
  });

  it('replaces a method while preserving original behavior and restores it', () => {
    const { spyOn } = initSpy();
    const obj = { greet: () => 'hi' };
    const original = obj.greet;

    const spy = spyOn(obj, 'greet');
    expect(obj.greet).not.toBe(original);
    expect(obj.greet()).toBe('hi');
    expect(spy.mock.calls).toHaveLength(1);

    spy.mockRestore();
    expect(obj.greet).toBe(original);
  });

  it('returns the existing mock when the method is already mocked', () => {
    const { spyOn } = initSpy();
    const obj = { greet: () => 'hi' };
    const spy1 = spyOn(obj, 'greet');
    const spy2 = spyOn(obj, 'greet');
    expect(spy2).toBe(spy1);
  });

  it('spies on a getter accessor', () => {
    const { spyOn } = initSpy();
    let backing = 1;
    let reads = 0;
    const obj = {} as { val: number };
    Object.defineProperty(obj, 'val', {
      configurable: true,
      get() {
        reads++;
        return backing;
      },
      set(next: number) {
        backing = next;
      },
    });

    const getSpy = spyOn(obj, 'val', 'get');
    expect(reads).toBe(0);
    void obj.val;
    expect(reads).toBe(1);
    expect(getSpy.mock.calls).toHaveLength(1);
  });

  it('restores the spy via Symbol.dispose', () => {
    if (!Symbol.dispose) return;
    const { spyOn } = initSpy();
    const obj = { greet: () => 'hi' };
    const original = obj.greet;

    const spy = spyOn(obj, 'greet');
    expect(obj.greet).not.toBe(original);
    (spy as unknown as Record<symbol, () => void>)[Symbol.dispose]!();
    expect(obj.greet).toBe(original);
  });
});
