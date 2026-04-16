import { describe, expect, rs, test } from '@rstest/core';

describe('rs.mockObject', () => {
  test('mocks methods to return undefined by default', () => {
    const mocked = rs.mockObject({
      method() {
        return 42;
      },
    });

    expect(mocked.method()).toBe(undefined);
    expect(rs.isMockFunction(mocked.method)).toBe(true);
  });

  test('keeps method name', () => {
    const mocked = rs.mockObject({
      myMethod() {
        return 42;
      },
    });

    expect(mocked.myMethod.getMockName()).toBe('myMethod');
  });

  test('mocks nested objects deeply', () => {
    const original = {
      simple: () => 'value',
      nested: {
        method: () => 'real',
      },
      prop: 'foo',
    };

    const mocked = rs.mockObject(original);
    expect(mocked.simple()).toBe(undefined);
    expect(mocked.nested.method()).toBe(undefined);
    expect(mocked.prop).toBe('foo');
  });

  test('can mock return values', () => {
    const mocked = rs.mockObject({
      simple: (): string => 'value',
      nested: {
        method: (): string => 'real',
      },
    });

    mocked.simple.mockReturnValue('mocked');
    mocked.nested.method.mockReturnValue('mocked nested');

    expect(mocked.simple()).toBe('mocked');
    expect(mocked.nested.method()).toBe('mocked nested');
  });

  test('with spy option keeps original implementations', () => {
    const original = {
      simple: () => 'value',
      nested: {
        method: () => 'real',
      },
    };

    const spied = rs.mockObject(original, { spy: true });
    expect(spied.simple()).toBe('value');
    expect(spied.simple).toHaveBeenCalled();
    expect(spied.simple.mock.results[0]).toEqual({
      type: 'return',
      value: 'value',
    });

    // Also verify nested methods are tracked
    expect(spied.nested.method()).toBe('real');
    expect(spied.nested.method).toHaveBeenCalled();
    expect(spied.nested.method.mock.results[0]).toEqual({
      type: 'return',
      value: 'real',
    });
  });

  test('arrays are empty by default', () => {
    const { array } = rs.mockObject({
      array: [1, 2, 3],
    });
    expect(array).toEqual([]);
  });

  test('arrays keep values when spy is true', () => {
    const { array } = rs.mockObject(
      {
        array: [1, 2, 3],
      },
      { spy: true },
    );
    expect(array).toHaveLength(3);
    expect(array[0]).toBe(1);
    expect(array[1]).toBe(2);
    expect(array[2]).toBe(3);
  });

  test('keeps primitive values', () => {
    const mocked = rs.mockObject({
      number: 123,
      string: 'hello',
      boolean: true,
      nullValue: null,
    });

    expect(mocked.number).toBe(123);
    expect(mocked.string).toBe('hello');
    expect(mocked.boolean).toBe(true);
    expect(mocked.nullValue).toBe(null);
  });

  test('deeply clones objects', () => {
    const mocked = rs.mockObject({
      obj: { a: 1, b: { c: 2 } },
    });

    expect(mocked.obj).toEqual({ a: 1, b: { c: 2 } });
  });

  test('mocks class constructors with spy option', () => {
    class OriginalClass {
      value = 42;
      getValue() {
        return this.value;
      }
    }
    const MockedClass = rs.mockObject(OriginalClass, { spy: true });
    const instance = new MockedClass();
    expect(instance.getValue()).toBe(42);
    rs.mocked(instance.getValue).mockImplementation(() => 100);
    expect(instance.getValue()).toBe(100);
  });

  test('mocks class constructors without spy option', () => {
    class OriginalClass {
      value = 42;
      getValue() {
        return this.value;
      }
    }
    const MockedClass = rs.mockObject(OriginalClass);
    expect(rs.isMockFunction(MockedClass)).toBe(true);
  });

  // Special object types tests
  test('preserves Date objects', () => {
    const date = new Date('2024-01-01');
    const mocked = rs.mockObject({ date });
    expect(mocked.date).toBe(date);
    expect(mocked.date instanceof Date).toBe(true);
  });

  test('preserves RegExp objects', () => {
    const regex = /test/gi;
    const mocked = rs.mockObject({ regex });
    expect(mocked.regex).toBe(regex);
    expect(mocked.regex instanceof RegExp).toBe(true);
  });

  test('preserves Map objects', () => {
    const map = new Map([['key', 'value']]);
    const mocked = rs.mockObject({ map });
    expect(mocked.map).toBe(map);
    expect(mocked.map instanceof Map).toBe(true);
  });

  test('preserves Set objects', () => {
    const set = new Set([1, 2, 3]);
    const mocked = rs.mockObject({ set });
    expect(mocked.set).toBe(set);
    expect(mocked.set instanceof Set).toBe(true);
  });

  // Circular reference tests
  test('handles self-referencing objects', () => {
    const original: Record<string, unknown> = { value: 1 };
    original.self = original;

    const mocked = rs.mockObject(original);
    expect(mocked.value).toBe(1);
    expect(mocked.self).toBe(mocked);
  });

  test('handles mutually referencing objects', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b' };
    a.ref = b;
    b.ref = a;

    const mocked = rs.mockObject({ a, b });
    expect(mocked.a.name).toBe('a');
    expect(mocked.b.name).toBe('b');
    expect(mocked.a.ref).toBe(mocked.b);
    expect(mocked.b.ref).toBe(mocked.a);
  });

  // Getter/setter tests
  test('handles getters in automock mode', () => {
    const original = {
      _value: 42,
      get value() {
        return this._value;
      },
    };
    const mocked = rs.mockObject(original);
    // In automock mode, getter returns undefined
    expect(mocked.value).toBe(undefined);
  });

  test('handles getters in spy mode', () => {
    const internalValue = 42;
    const original = Object.defineProperty({} as { value: number }, 'value', {
      get() {
        return internalValue;
      },
      configurable: true,
      enumerable: true,
    });
    const spied = rs.mockObject(original, { spy: true });
    expect(spied.value).toBe(42);
  });

  // Symbol property tests
  test('handles symbol properties', () => {
    const sym = Symbol('test');
    const original = {
      [sym]: 'symbol value',
      regular: 'regular value',
    };

    const mocked = rs.mockObject(original);
    expect(mocked[sym]).toBe('symbol value');
    expect(mocked.regular).toBe('regular value');
  });
});

describe('rs.mocked', () => {
  test('returns the same object', () => {
    const mock = rs.fn();
    const mocked = rs.mocked(mock);
    expect(mocked).toBe(mock);
  });

  test('works with deep option', () => {
    const mock = rs.fn();
    const mocked = rs.mocked(mock, true);
    expect(mocked).toBe(mock);
  });

  test('works with options object', () => {
    const mock = rs.fn();
    const mocked = rs.mocked(mock, { partial: true, deep: true });
    expect(mocked).toBe(mock);
  });
});
