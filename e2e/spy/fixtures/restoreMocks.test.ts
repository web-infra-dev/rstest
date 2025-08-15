import { describe, expect, it, rstest } from '@rstest/core';

describe('auto restoreMocks', () => {
  const hi = {
    sayHi: () => 'hi',
  };

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
