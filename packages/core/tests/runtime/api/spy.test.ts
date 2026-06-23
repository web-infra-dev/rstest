import { describe, expect, it } from '@rstest/core';
import { initSpy } from '../../../src/runtime/api/spy';

describe('initSpy fn()', () => {
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
    const obj = {};
    Object.defineProperty(obj, 'val', {
      configurable: true,
      get() {
        return backing;
      },
      set(next: number) {
        backing = next;
      },
    });

    const getSpy = spyOn(obj, 'val', 'get');
    void (obj as { val: number }).val;
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
