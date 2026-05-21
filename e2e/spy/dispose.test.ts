import { describe, expect, it, rstest } from '@rstest/core';

describe('mock dispose', () => {
  it('restores spies when leaving a using scope', () => {
    const hi = {
      sayHi: () => 'hi',
    };

    {
      using spy = rstest.spyOn(hi, 'sayHi').mockImplementation(() => 'hello');

      expect(hi.sayHi()).toBe('hello');
      expect(spy).toHaveBeenCalledTimes(1);
    }

    expect(hi.sayHi()).toBe('hi');
    expect(rstest.isMockFunction(hi.sayHi)).toBeFalsy();
  });

  it('resets mock functions when disposed manually', () => {
    const sayHi = rstest.fn(() => 'hi').mockImplementation(() => 'hello');

    expect(sayHi()).toBe('hello');

    sayHi[Symbol.dispose]();

    expect(sayHi()).toBe('hi');
  });
});
