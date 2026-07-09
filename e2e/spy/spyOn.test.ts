import { describe, expect, it, rstest } from '@rstest/core';
import * as utils from './fixtures/util';

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

  it('isMockFunction', () => {
    const hi = {
      sayHi: () => 'hi',
    };
    const spy = rstest.spyOn(hi, 'sayHi');

    expect(rstest.isMockFunction(spy)).toBeTruthy();
    expect(rstest.isMockFunction(hi.sayHi)).toBeTruthy();

    spy.mockRestore();
    expect(rstest.isMockFunction(hi.sayHi)).toBeFalsy();
  });

  it('spyOn import', () => {
    expect(() => {
      // @ts-expect-error test
      utils.sayHi = () => 'hello';
    }).toThrowError(
      'Cannot set property sayHi of #<Object> which has only a getter',
    );

    const spy = rstest.spyOn(utils, 'sayHi');

    expect(utils.sayHi()).toBe('hi');

    expect(utils.sayHi).toBeCalled();

    spy.mockImplementation(() => 'hello');

    expect(utils.sayHi()).toBe('hello');

    spy.mockReset();

    expect(utils.sayHi()).toBe('hi');
  });

  it('spyOn dynamic import', async () => {
    const util1 = await import('./fixtures/util');
    const spy = rstest.spyOn(util1, 'sayHi');

    expect(util1.sayHi()).toBe('hi');
    expect(util1.sayHi).toBeCalled();

    spy.mockImplementation(() => 'hello');

    expect(util1.sayHi()).toBe('hello');

    spy.mockReset();
    expect(util1.sayHi()).toBe('hi');
  });

  it('spyOn re-spy', () => {
    const hi = {
      sayHi: () => 'hi',
    };
    rstest.spyOn(hi, 'sayHi').mockImplementation(() => 'hello');

    expect(hi.sayHi()).toBe('hello');
    // should get the same spy instance
    expect(rstest.spyOn(hi, 'sayHi')).toBeCalled();
  });
});
