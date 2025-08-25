import { describe, expect, it, rstest } from '@rstest/core';

describe('auto clearMocks', () => {
  const sayHi = rstest.fn();

  it('spy', () => {
    sayHi.mockImplementation(() => 'hi');

    expect(sayHi('bob')).toBe('hi');

    expect(sayHi).toHaveBeenCalledTimes(1);
  });

  it('spy - 1', () => {
    sayHi.mockImplementation(() => 'hello');

    expect(sayHi('bob')).toBe('hello');

    expect(sayHi).toHaveBeenCalledTimes(1);
  });
});
