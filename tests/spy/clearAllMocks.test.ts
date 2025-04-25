import { afterEach, describe, expect, it, rstest } from '@rstest/core';

describe('clearAllMocks', () => {
  const sayHi = rstest.fn();

  afterEach(() => {
    rstest.clearAllMocks();
  });
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
