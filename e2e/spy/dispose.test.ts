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

describe('utility dispose', () => {
  it('restores env values when leaving a using scope', () => {
    const name = 'RSTEST_DISPOSE_ENV';
    delete process.env[name];

    {
      using _env = rstest.stubEnv(name, 'outer');
      expect(process.env[name]).toBe('outer');

      {
        using _nestedEnv = rstest.stubEnv(name, 'inner');
        expect(process.env[name]).toBe('inner');
      }

      expect(process.env[name]).toBe('outer');
    }

    expect(process.env[name]).toBeUndefined();
  });

  it('restores globals when leaving a using scope', () => {
    const name = Symbol.for('rstest.dispose.global');
    Reflect.deleteProperty(globalThis, name);

    {
      using _global = rstest.stubGlobal(name, 'outer');
      expect(globalThis[name]).toBe('outer');

      {
        using _nestedGlobal = rstest.stubGlobal(name, 'inner');
        expect(globalThis[name]).toBe('inner');
      }

      expect(globalThis[name]).toBe('outer');
    }

    expect(globalThis[name]).toBeUndefined();
  });

  it('restores real timers when leaving a using scope', () => {
    expect(rstest.isFakeTimers()).toBe(false);

    {
      using _timers = rstest.useFakeTimers();
      expect(rstest.isFakeTimers()).toBe(true);
    }

    expect(rstest.isFakeTimers()).toBe(false);
  });
});
