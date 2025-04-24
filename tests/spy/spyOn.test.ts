import { describe, expect, it, rstest } from '@rstest/core';

describe('test spyOn', () => {
  it('spyOn', () => {
    const sayHi = () => 'hi';
    const hi = {
      sayHi,
    };
    const spy = rstest.spyOn(hi, 'sayHi');

    expect(hi.sayHi()).toBe('hi');

    expect(spy).toHaveBeenCalled();

    spy.mockImplementation(() => 'hello');

    expect(hi.sayHi()).toBe('hello');

    spy.mockRestore();

    expect(hi.sayHi()).toBe('hi');

    expect(hi.sayHi).toEqual(sayHi);

    spy.mockImplementation(() => 'mocked');

    expect(hi.sayHi()).toBe('hi');
  });
});
