import { describe, expect, it } from '@rstest/core';
import { browserLaunchKey } from '../src/browserRsbuild';
import { toWireRow } from '../src/protocol';
import type { BrowserProjectRuntime } from '../src/protocol';

const keyOf = (launch?: unknown) =>
  browserLaunchKey({
    provider: 'playwright',
    browserName: 'chromium',
    headless: true,
    providerOptions: launch === undefined ? {} : { launch },
  });

class Logger {
  self = this;
  isEnabled = () => true;
}

describe('browserLaunchKey', () => {
  it('does not throw on cyclic class instances in launch options', () => {
    const logger = new Logger();
    expect(() => keyOf({ logger })).not.toThrow();
  });

  it('does not throw on cyclic plain objects and is stable for equal shapes', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    const b: Record<string, unknown> = { x: 1 };
    b.self = b;
    expect(keyOf(a)).toBe(keyOf(b));
  });

  it('separates launches whose logger callbacks differ', () => {
    const one = { logger: { isEnabled: () => true } };
    const two = { logger: { isEnabled: () => true } };
    expect(keyOf({ logger: one })).not.toBe(keyOf({ logger: two }));
    expect(keyOf({ onLog: () => {} })).not.toBe(keyOf({ onLog: () => {} }));
  });

  it('shares a launch when the same instance is reused', () => {
    const logger = new Logger();
    const fn = () => {};
    expect(keyOf({ logger, fn })).toBe(keyOf({ fn, logger }));
  });

  it('keys symbols by identity without throwing, including registered ones', () => {
    expect(() => keyOf({ tag: Symbol.for('rstest.launch') })).not.toThrow();
    expect(keyOf({ tag: Symbol.for('rstest.launch') })).toBe(
      keyOf({ tag: Symbol.for('rstest.launch') }),
    );
    expect(keyOf({ tag: Symbol('a') })).not.toBe(keyOf({ tag: Symbol('a') }));
    const local = Symbol('local');
    expect(keyOf({ tag: local })).toBe(keyOf({ tag: local }));
  });

  it('treats equal plain values as the same launch regardless of key order', () => {
    expect(keyOf({ args: ['--a', '--b'], timeout: 10 })).toBe(
      keyOf({ timeout: 10, args: ['--a', '--b'] }),
    );
    expect(keyOf({ args: ['--a'] })).not.toBe(keyOf({ args: ['--b'] }));
    expect(keyOf(undefined)).toBe(keyOf(null));
  });

  it('keeps provider, browser and headless in the key', () => {
    const base = {
      provider: 'playwright',
      browserName: 'chromium',
      headless: true,
      providerOptions: {},
    } as const;
    expect(browserLaunchKey(base)).not.toBe(
      browserLaunchKey({ ...base, headless: false }),
    );
    expect(browserLaunchKey(base)).not.toBe(
      browserLaunchKey({ ...base, browserName: 'firefox' }),
    );
  });
});

describe('toWireRow', () => {
  it('drops host-only providerOptions so a row serializes even with cycles', () => {
    const logger = new Logger();
    const row = {
      name: 'p',
      providerOptions: { launch: { logger } },
    } as unknown as BrowserProjectRuntime;
    expect(() => JSON.stringify(row)).toThrow();
    const wire = toWireRow(row);
    expect('providerOptions' in wire).toBe(false);
    expect(JSON.parse(JSON.stringify(wire))).toEqual({ name: 'p' });
  });
});
