import { runInNewContext } from 'node:vm';
import { describe, expect, it } from '@rstest/core';
import { initSpy } from '../../../src/runtime/api/spy';

describe('initSpy fn()', () => {
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

  it('visits and clears every created mock through forEachMock', () => {
    const { fn, spyOn, forEachMock } = initSpy();
    const a = fn();
    const obj = { method: () => 'real' };
    const b = spyOn(obj, 'method');

    const visited = new Set();
    forEachMock((mock) => visited.add(mock));
    expect(visited.has(a)).toBe(true);
    expect(visited.has(b)).toBe(true);

    a();
    obj.method();
    // Mirror clearAllMocks: iterate the live registry.
    forEachMock((mock) => mock.mockClear());
    expect(a.mock.calls).toHaveLength(0);
    expect(b.mock.calls).toHaveLength(0);
  });

  it('scopes mocks per project so one project does not reset another', () => {
    // A reused worker under `isolate: false` serves several projects through one
    // `rstest` singleton; the project key resolves the running file's project.
    let project = 'A';
    const { fn, forEachMock } = initSpy(() => project);

    const mockA = fn();
    mockA();
    expect(mockA.mock.calls).toHaveLength(1);

    // Project B's `*AllMocks` iteration must not see A's mock.
    project = 'B';
    forEachMock((mock) => mock.mockClear());
    project = 'A';
    expect(mockA.mock.calls).toHaveLength(1);

    // A's own iteration still reaches it.
    forEachMock((mock) => mock.mockClear());
    expect(mockA.mock.calls).toHaveLength(0);
  });
});

describe('initSpy withImplementation', () => {
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
    const context = runInNewContext('globalThis', {}) as Record<string, any>;
    const { fn } = initSpy(
      () => '',
      () => context,
    );
    const spy = fn(() => 'original');

    const result = spy.withImplementation(
      () => 'temporary',
      () => runInNewContext('Promise.resolve()', context),
    );

    expect(await result).toBe(spy);
  });
});

describe('initSpy spyOn', () => {
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
