import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it, rs } from '@rstest/core';

const runtimeCode = readFileSync(
  join(__dirname, '../../../src/core/plugins/mockRuntimeCode.js'),
  'utf-8',
);

type WebpackRequireStub = ((id: string) => unknown) & Record<string, any>;

const createWebpackRequireStub = (): WebpackRequireStub =>
  Object.assign((id: string) => {
    throw new Error(`__webpack_modules__[moduleId] is not a function (${id})`);
  }, {}) as WebpackRequireStub;

/**
 * Evaluate the runtime module the way a bundle would: webpack globals are
 * provided as bindings in scope, and the returned value is the proxied
 * `__webpack_require__` that subsequent webpack runtime modules interact with.
 */
const evaluateRuntimeCode = ({
  federation,
  globalStub = {},
  webpackRequire = createWebpackRequireStub(),
}: {
  federation: boolean;
  globalStub?: Record<string, unknown>;
  webpackRequire?: WebpackRequireStub;
}) => {
  const fakeGlobal: Record<string, any> = {
    __rstest_federation__: federation,
    ...globalStub,
  };
  const evaluate = new Function(
    'globalThis',
    '__webpack_require__',
    '__webpack_modules__',
    '__webpack_module_cache__',
    `${runtimeCode}\nreturn __webpack_require__;`,
  );
  const proxiedRequire: WebpackRequireStub = evaluate(
    fakeGlobal,
    webpackRequire,
    {},
    {},
  );
  return { fakeGlobal, webpackRequire, proxiedRequire };
};

describe('mockRuntimeCode federation shims', () => {
  it('does not install federation shims when federation is disabled', () => {
    const { fakeGlobal, proxiedRequire } = evaluateRuntimeCode({
      federation: false,
    });

    expect(fakeGlobal.__rstest_dynamic_import__).toBeUndefined();

    proxiedRequire.f = {};
    expect(proxiedRequire.f.consumes).toBeUndefined();
    expect(proxiedRequire.f.remotes).toBeUndefined();

    const firstLoader = () => 'first';
    const secondLoader = () => 'second';
    proxiedRequire.f.readFileVm = firstLoader;
    proxiedRequire.f.readFileVm = secondLoader;
    expect(proxiedRequire.f.readFileVm).toBe(secondLoader);
  });

  it('installs a native dynamic import fallback on globalThis', () => {
    const { fakeGlobal } = evaluateRuntimeCode({ federation: true });

    expect(typeof fakeGlobal.__rstest_dynamic_import__).toBe('function');
  });

  it('preserves an existing globalThis dynamic import implementation', () => {
    const existing = () => Promise.resolve({});
    const { fakeGlobal } = evaluateRuntimeCode({
      federation: true,
      globalStub: { __rstest_dynamic_import__: existing },
    });

    expect(fakeGlobal.__rstest_dynamic_import__).toBe(existing);
  });

  it('pre-seeds no-op consumes/remotes handlers when f is assigned', () => {
    const { proxiedRequire } = evaluateRuntimeCode({ federation: true });

    proxiedRequire.f = {};

    expect(typeof proxiedRequire.f.consumes).toBe('function');
    expect(typeof proxiedRequire.f.remotes).toBe('function');
    expect(() => proxiedRequire.f.consumes()).not.toThrow();
    expect(() => proxiedRequire.f.remotes()).not.toThrow();
  });

  it('keeps handlers that were assigned together with f', () => {
    const { proxiedRequire } = evaluateRuntimeCode({ federation: true });

    const consumes = () => 'consumes';
    proxiedRequire.f = { consumes };

    expect(proxiedRequire.f.consumes).toBe(consumes);
    expect(typeof proxiedRequire.f.remotes).toBe('function');
  });

  it('blocks overwriting installed chunk-loading handlers', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { proxiedRequire } = evaluateRuntimeCode({ federation: true });

      proxiedRequire.f = {};

      const installedLoader = () => 'installed';
      const hijackedLoader = () => 'hijacked';
      proxiedRequire.f.readFileVm = installedLoader;
      proxiedRequire.f.readFileVm = hijackedLoader;
      proxiedRequire.f.require = installedLoader;
      proxiedRequire.f.require = hijackedLoader;

      expect(proxiedRequire.f.readFileVm).toBe(installedLoader);
      expect(proxiedRequire.f.require).toBe(installedLoader);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('replaces throwing placeholders installed before the runtime module', () => {
    const webpackRequire = createWebpackRequireStub();
    webpackRequire.f = {
      consumes: () => {
        throw new Error('should have __webpack_require__.f.consumes installed');
      },
      readFileVm: () => 'chunk loader',
    };

    const { proxiedRequire } = evaluateRuntimeCode({
      federation: true,
      webpackRequire,
    });

    expect(() => proxiedRequire.f.consumes()).not.toThrow();
    expect(proxiedRequire.f.readFileVm()).toBe('chunk loader');
  });

  it('keeps pre-installed placeholders when federation is disabled', () => {
    const webpackRequire = createWebpackRequireStub();
    webpackRequire.f = {
      consumes: () => {
        throw new Error('should have __webpack_require__.f.consumes installed');
      },
    };

    const { proxiedRequire } = evaluateRuntimeCode({
      federation: false,
      webpackRequire,
    });

    expect(() => proxiedRequire.f.consumes()).toThrow(
      'should have __webpack_require__.f.consumes installed',
    );
  });
});
