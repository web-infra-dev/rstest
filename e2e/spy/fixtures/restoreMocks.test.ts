import { describe, expect, it, rstest } from '@rstest/core';

describe('auto restoreMocks', () => {
  const hi = {
    sayHi: () => 'hi',
  };
  const getUser = rstest.fn().mockReturnValue({ name: 'Ada' });

  it('keeps configured mock implementations and call history', () => {
    expect(getUser()).toEqual({ name: 'Ada' });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('keeps configured mock implementations across tests', () => {
    expect(getUser()).toEqual({ name: 'Ada' });
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('spy', () => {
    const spy = rstest.spyOn(hi, 'sayHi');

    spy.mockImplementation(() => 'hello');

    expect(hi.sayHi()).toBe('hello');
  });

  it('spy - 1', () => {
    expect(hi.sayHi()).toBe('hi');
    expect(rstest.isMockFunction(hi.sayHi)).toBeFalsy();
  });
});
