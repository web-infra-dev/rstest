import { describe, expect, it, rstest } from '@rstest/core';

describe('test spy', () => {
  it('rstest.fn -> mockName', () => {
    const sayHi = rstest.fn((name: string) => `hi ${name}`);
    const sayHello = rstest.fn(function sayHelloFn(name: string) {
      return `hello ${name}`;
    });

    expect(sayHi._isMockFunction).toBeTruthy();
    expect(sayHi.getMockName()).toBe('rstest.fn()');
    expect(sayHello.getMockName()).toBe('sayHelloFn');

    sayHi.mockName('sayHi');
    expect(sayHi.getMockName()).toBe('sayHi');
  });

  it('rstest.fn -> mock context', () => {
    const sayHi = rstest.fn((name: string) => `hi ${name}`);
    const sayHello = rstest.fn((name: string) => `hello ${name}`);

    const res = sayHi('bob');

    expect(res).toBe('hi bob');

    expect(sayHi.mock.calls).toEqual([['bob']]);

    expect(sayHi).toHaveBeenCalledTimes(1);
    expect(sayHi).toHaveBeenCalledWith('bob');
    expect(sayHello).not.toHaveBeenCalled();

    sayHi('Tom');
    expect(sayHi).toHaveBeenLastCalledWith('Tom');
    expect(sayHi).toHaveBeenCalledTimes(2);
  });
});
