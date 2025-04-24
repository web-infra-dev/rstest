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
    expect(sayHi.mock.results).toEqual([
      {
        type: 'return',
        value: 'hi bob',
      },
    ]);

    expect(sayHi).toHaveBeenCalledTimes(1);
    expect(sayHi).toHaveBeenCalledWith('bob');
    expect(sayHello).not.toHaveBeenCalled();

    sayHi('Tom');
    expect(sayHi).toHaveBeenLastCalledWith('Tom');
    expect(sayHi).toHaveBeenCalledTimes(2);
  });

  it('rstest.fn -> mockImplementation', () => {
    const sayHi = rstest.fn();

    expect(sayHi.getMockImplementation()).toBeUndefined();

    const res = sayHi('bob');

    expect(res).toBeUndefined();

    const sayHiImpl = (name: string) => `hi ${name}`;

    sayHi.mockImplementation(sayHiImpl).mockImplementationOnce(() => 'hi');

    expect(sayHi('bob')).toBe('hi');

    expect(sayHi('bob')).toBe('hi bob');

    expect(sayHi.getMockImplementation()).toEqual(sayHiImpl);

    expect(sayHi('tom')).toBe('hi tom');

    expect(sayHi).toHaveBeenCalledTimes(4);
  });

  it('rstest.fn -> mock clear / reset / restore', () => {
    const sayHi = rstest.fn(function sayHiFn(name: string) {
      return `hi ${name}`;
    });
    const sayHello = rstest.fn();

    expect(sayHi.getMockName()).toBe('sayHiFn');
    sayHi.mockImplementation(() => 'hi');
    sayHello.mockImplementation(() => 'hello');

    expect(sayHi('bob')).toBe('hi');
    expect(sayHello('bob')).toBe('hello');

    sayHi.mockName('sayHi');
    expect(sayHi.getMockName()).toBe('sayHi');

    expect(sayHi.mock.calls).toEqual([['bob']]);

    sayHi.mockClear();
    sayHello.mockClear();

    expect(sayHi.getMockName()).toBe('sayHi');

    expect(sayHi.mock.calls).toEqual([]);

    expect(sayHi).toHaveBeenCalledTimes(0);

    expect(sayHi('bob')).toBe('hi');
    expect(sayHello()).toBe('hello');

    sayHi.mockReset();
    sayHello.mockReset();

    expect(sayHi.getMockName()).toBe('sayHi');

    expect(sayHi.mock.calls).toEqual([]);

    expect(sayHi('bob')).toBe('hi bob');
    expect(sayHello()).toBeUndefined();

    sayHi.mockRestore();
    sayHello.mockRestore();

    expect(sayHi.getMockName()).toBe('sayHiFn');
    expect(sayHello.getMockName()).toBe('rstest.fn()');
  });

  it('rstest.fn -> mock returns', () => {
    const sayHi = rstest.fn();

    const res = sayHi('bob');

    expect(res).toBeUndefined();

    expect(sayHi).toHaveReturned();

    expect(sayHi.getMockImplementation()).toBeUndefined();

    sayHi.mockReturnValue('hi').mockReturnValueOnce('hello');

    expect(sayHi.getMockImplementation()).toBeDefined();

    expect(sayHi()).toBe('hello');

    expect(sayHi()).toBe('hi');

    expect(sayHi()).toBe('hi');

    expect(sayHi).toHaveBeenCalledTimes(4);

    sayHi.mockReset();

    expect(sayHi()).toBeUndefined();
  });

  it('rstest.fn -> mock async returns', async () => {
    const sayHi = rstest.fn(() => Promise.resolve(''));

    await expect(sayHi()).resolves.toBe('');

    sayHi.mockResolvedValue('hi').mockResolvedValueOnce('hello');

    await expect(sayHi()).resolves.toBe('hello');

    await expect(sayHi()).resolves.toBe('hi');

    sayHi
      .mockRejectedValue(new Error('hi'))
      .mockRejectedValueOnce(new Error('hello'));

    await expect(sayHi()).rejects.toThrowError('hello');
    await expect(sayHi()).rejects.toThrowError('hi');
  });

  it('rstest.fn -> mock return this', () => {
    const sayHi = rstest.fn(function mockFn(this: any) {
      return `hi ${this?.name}`;
    });

    expect(sayHi.call({ name: 'bob' })).toBe('hi bob');

    sayHi.mockReturnThis();
    expect(sayHi.call({ name: 'bob' })).toEqual({ name: 'bob' });
  });
});
