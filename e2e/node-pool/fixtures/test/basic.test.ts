import { describe, expect, it, rs } from '@rstest/core';
import { getCount, increment } from '../src/index';

const FILE_MARKER = '__rstest_threads_pool_file_marker__';

describe('node pool - basic', () => {
  it('runs sync tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('runs async tests', async () => {
    const value = await Promise.resolve(42);
    expect(value).toBe(42);
  });

  it('reuses the timers shim for both builtin spellings', () => {
    const timers = require('timers');
    const nodeTimers = require('node:timers');

    expect(timers).toBe(nodeTimers);
    const hostGlobal = require('node:vm').runInThisContext('globalThis');
    if (hostGlobal !== globalThis) {
      expect(timers.setTimeout).toBe(globalThis.setTimeout);
    }
  });

  it('records settled results from the test realm', async () => {
    const mock = rs.fn(async () => 42);

    await mock();

    expect(mock.mock.settledResults).toEqual([
      { type: 'fulfilled', value: 42 },
    ]);
  });

  it('matches VM-realm constructors in asymmetric matchers', () => {
    expect('value').toEqual(expect.any(String));
    expect(42).toEqual(expect.any(Number));
    expect(Object('value')).toEqual(expect.any(String));
    expect(Object(42)).toEqual(expect.any(Number));
    expect(Object(true)).toEqual(expect.any(Boolean));
    expect(Object(42n)).toEqual(expect.any(BigInt));
    expect(Object(Symbol('value'))).toEqual(expect.any(Symbol));
    expect(new (class extends String {})('value')).toEqual(expect.any(String));
    expect(() => {}).not.toEqual(expect.any(Object));
    expect(Object.create(Function.prototype)).not.toEqual(expect.any(Function));
    expect({ value: 42 }).toEqual(
      expect.objectContaining({ value: expect.any(Number) }),
    );
  });

  it('can import source modules and observe local mutation', () => {
    increment();
    expect(getCount()).toBe(1);
  });

  it('runs in the expected worker transport', () => {
    expect(typeof process.send).toBe(
      process.env.RSTEST_EXPECT_FORKS ? 'function' : 'undefined',
    );
  });

  it('starts with a clean file global', () => {
    expect(document.body).toBeDefined();
    const fileGlobal = globalThis as typeof globalThis &
      Record<string, unknown>;
    expect(fileGlobal[FILE_MARKER]).toBeUndefined();
    fileGlobal[FILE_MARKER] = 'basic';
  });
});
