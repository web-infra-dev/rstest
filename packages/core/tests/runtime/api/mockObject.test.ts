import { describe, expect, it } from '@rstest/core';
import { mockObject } from '../../../src/runtime/api/mockObject';
import { initSpy } from '../../../src/runtime/api/spy';

type Key = string | symbol;

const globalConstructors = { Object, Function, Array, Map, RegExp };

const make = (type: 'automock' | 'autospy') => {
  const { createMockInstance, isMockFunction } = initSpy();
  return {
    isMockFunction,
    run: <T extends Record<Key, any>>(object: T): T =>
      mockObject({ createMockInstance, globalConstructors, type }, object, {}),
  };
};

describe('mockObject automock', () => {
  it('empties arrays', () => {
    const { run } = make('automock');
    expect(run({ list: [1, 2, 3] }).list).toEqual([]);
  });

  it('makes getters return undefined', () => {
    const { run } = make('automock');
    const source = {};
    Object.defineProperty(source, 'value', {
      enumerable: true,
      configurable: true,
      get: () => 42,
    });
    expect((run(source) as { value: unknown }).value).toBeUndefined();
  });

  it('replaces functions with empty mocks', () => {
    const { run, isMockFunction } = make('automock');
    const result = run({ doThing: () => 'real' });
    expect(isMockFunction(result.doThing)).toBe(true);
    expect(result.doThing()).toBeUndefined();
  });

  it('passes primitives through unchanged', () => {
    const { run } = make('automock');
    const result = run({ n: 1, s: 'x', b: true, nil: null });
    expect(result.n).toBe(1);
    expect(result.s).toBe('x');
    expect(result.b).toBe(true);
    expect(result.nil).toBeNull();
  });

  it('returns Date/RegExp/Map values by reference', () => {
    const { run } = make('automock');
    const date = new Date(0);
    const regexp = /abc/;
    const map = new Map([['k', 'v']]);
    const result = run({ date, regexp, map });
    expect(result.date).toBe(date);
    expect(result.regexp).toBe(regexp);
    expect(result.map).toBe(map);
  });

  it('resolves circular references without infinite recursion', () => {
    const { run } = make('automock');
    const source: Record<string, any> = { name: 'a' };
    source.self = source;
    const result = run(source);
    expect(result.name).toBe('a');
    expect(result.self).toBe(result);
  });

  it('collects only own properties for __esModule objects', () => {
    const { run, isMockFunction } = make('automock');
    const proto = { inherited: () => 'p' };
    const mod = Object.create(proto);
    mod.__esModule = true;
    mod.own = () => 'o';
    const result = run(mod);
    expect(isMockFunction(result.own)).toBe(true);
    expect('inherited' in result).toBe(false);
  });

  it('mocks nested objects lazily', () => {
    const { run, isMockFunction } = make('automock');
    let enumerated = false;
    const nested = new Proxy(
      { method: () => 'real' },
      {
        ownKeys: (target) => {
          enumerated = true;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor: (target, prop) => {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      },
    );
    const result = run({ nested });

    expect(enumerated).toBe(false);
    expect(isMockFunction(result.nested.method)).toBe(true);
    expect(enumerated).toBe(true);
  });

  it('allows lazy mocked properties to be overwritten', () => {
    const { run } = make('automock');
    const result = run({ nested: { value: 1 } });

    result.nested = { value: 2 };

    expect(result.nested.value).toBe(2);
  });

  it('preserves constructor prototype mocks', () => {
    const { run, isMockFunction } = make('automock');
    class Foo {
      greet(): string {
        return 'hi';
      }
    }

    const MockedFoo = run(Foo);

    expect(isMockFunction(MockedFoo.prototype.greet)).toBe(true);
    expect(MockedFoo.prototype.greet()).toBeUndefined();
  });

  it('snapshots nested values before lazy mock initialization', () => {
    const { run, isMockFunction } = make('automock');
    const original = {
      nested: {
        method: () => 'original',
      },
    };

    const result = run(original);
    original.nested.method = () => 'new';

    expect(isMockFunction(result.nested.method)).toBe(true);
    expect(result.nested.method()).toBeUndefined();
  });

  it('creates independent mocks for aliased functions', () => {
    const { run } = make('automock');
    const fn = () => 'real';
    const result = run({ a: fn, b: fn });

    expect(result.a).not.toBe(result.b);

    result.a();

    expect(result.a.mock.calls).toHaveLength(1);
    expect(result.b.mock.calls).toHaveLength(0);
  });
});

describe('mockObject autospy', () => {
  it('wraps functions preserving the original implementation', () => {
    const { run, isMockFunction } = make('autospy');
    const result = run({ doThing: (x: number) => x + 1 });
    expect(isMockFunction(result.doThing)).toBe(true);
    expect(result.doThing(2)).toBe(3);
    expect(result.doThing.mock.calls).toEqual([[2]]);
  });

  it('deep-clones arrays into a new identity', () => {
    const { run } = make('autospy');
    const source = { list: [1, 2, 3] };
    const result = run(source);
    expect(result.list).toEqual([1, 2, 3]);
    expect(result.list).not.toBe(source.list);
  });

  it('preserves getters via their descriptor', () => {
    const { run } = make('autospy');
    const source = {};
    Object.defineProperty(source, 'value', {
      enumerable: true,
      configurable: true,
      get: () => 7,
    });
    expect((run(source) as { value: unknown }).value).toBe(7);
  });

  it('instantiates class constructors with prototype-method spies', () => {
    const { run, isMockFunction } = make('autospy');
    class Foo {
      greet(): string {
        return 'hi';
      }
    }
    const result = run({ Foo });
    expect(isMockFunction(result.Foo)).toBe(true);

    const instance = new result.Foo();
    expect(isMockFunction(instance.greet)).toBe(true);
    expect(instance.greet()).toBe('hi');
    expect(instance.greet.mock.calls).toHaveLength(1);
  });

  it('snapshots nested object properties before access', () => {
    const { run, isMockFunction } = make('autospy');
    let enumerated = false;
    const nested = new Proxy(
      { method: () => 'real' },
      {
        ownKeys: (target) => {
          enumerated = true;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor: (target, prop) => {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      },
    );
    const result = run({ nested });

    expect(enumerated).toBe(true);
    expect(isMockFunction(result.nested.method)).toBe(true);
    expect(result.nested.method()).toBe('real');
  });

  it('snapshots nested values before lazy spy initialization', () => {
    const { run } = make('autospy');
    const original = {
      nested: {
        method: () => 'original',
      },
    };

    const result = run(original);
    original.nested.method = () => 'new';

    expect(result.nested.method()).toBe('original');
  });

  it('creates independent spies for aliased functions', () => {
    const { run } = make('autospy');
    const fn = () => 'real';
    const result = run({ a: fn, b: fn });

    expect(result.a).not.toBe(result.b);

    expect(result.a()).toBe('real');

    expect(result.a.mock.calls).toHaveLength(1);
    expect(result.b.mock.calls).toHaveLength(0);
  });
});
