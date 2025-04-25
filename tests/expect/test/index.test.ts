import { describe, expect, it } from '@rstest/core';

describe('Expect API', () => {
  it('test expect API', () => {
    expect(1 + 1).toBe(2);
    expect('blue red').toBeDefined();
    expect(Number.NaN).toBeNaN();

    const hi = () => {};
    expect(hi()).toBeUndefined();
    expect(hi()).toBeFalsy();

    const sayHi = () => 'hi';
    expect(sayHi()).toBe('hi');
    expect(sayHi()).toBeTruthy();

    expect(null).toBeNull();
  });

  it('test number expect', () => {
    expect(0.2 + 0.1).toBeCloseTo(0.3, 5);

    expect(2).toBeGreaterThan(1);

    expect(2).toBeGreaterThanOrEqual(2);
  });

  it('expect toHaveLength', () => {
    expect('red').toHaveLength(3);
    expect(['blue', 'red']).toHaveLength(2);
    expect({ length: 3 }).toHaveLength(3);
  });

  it('test array expect', () => {
    expect(['blue', 'red']).toContain('blue');

    expect('red').toBeOneOf(['blue', 'green', 'red']);
  });

  it('test object expect', () => {
    const obj = {
      name: 'blue',
    };
    expect(obj).toEqual({ ...obj });
    expect(obj).toEqual({ ...obj, type: undefined });
    expect(obj).not.toStrictEqual({ ...obj, type: undefined });

    expect({ name: 'blue', type: 'color' }).toMatchObject(obj);
  });

  it('test expect type', () => {
    expect('red').toBeTypeOf('string');

    class Test {
      constructor(public name: string) {}
    }
    const test = new Test('blue');
    expect(test).toBeInstanceOf(Test);
  });

  it('test expect modifiers', async () => {
    expect(Promise.resolve('blue')).resolves.toBe('blue');
    expect(Promise.reject(new Error('red'))).rejects.toThrow('red');

    await expect(
      new Promise((resolve) => {
        setTimeout(() => {
          resolve('blue');
        }, 100);
      }),
    ).resolves.toBe('blue');
  });

  it('test expect toSatisfy', () => {
    const isOdd = (num: number) => num % 2 === 1;
    expect(1).toSatisfy(isOdd);
    expect(2).not.toSatisfy(isOdd);
  });

  it('test expect assertions', () => {
    expect.assertions(3);
    expect(1 + 1).toBe(2);
    expect(1 + 2).toBe(3);
    expect(1 + 3).toBe(4);
  });

  it('test expect API not', () => {
    expect(1 + 1).not.toBe(3);
    expect('blue red').not.toBeUndefined();
    expect(1).not.toBeNaN();

    expect(true).not.toBeFalsy();
    expect(false).not.toBeTruthy();
    expect(undefined).not.toBeNull();

    expect(['blue', 'red']).not.toContain('blu');
    expect('blue red').not.toMatch('redd');
  });

  it.fails('test not failed', () => {
    expect(1 + 1).not.toBe(2);
  });

  it.fails('test expect assertions failed', () => {
    expect(1 + 1).toBe(2);
    expect.assertions(2);
    expect(1 + 2).toBe(3);
    expect(1 + 3).toBe(4);
  });
});
