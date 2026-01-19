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

  test('mocks class constructors', () => {
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
