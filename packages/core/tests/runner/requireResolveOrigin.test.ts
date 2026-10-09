import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import vm from 'node:vm';
import { onTestFinished, rs } from '@rstest/core';
import path from 'pathe';
import {
  clearCompilationCache as clearEsCompilationCache,
  clearModuleCache as clearEsModuleCache,
  loadModule as loadEsModule,
} from '../../src/runtime/worker/loadEsModule';
import {
  clearCompilationCache as clearCjsCompilationCache,
  clearModuleCache as clearCjsModuleCache,
  loadModule,
} from '../../src/runtime/worker/loadModule';
import { workerCache } from '../../src/runtime/worker/vm/cache';

describe('require.resolve origin runtime helper', () => {
  afterEach(() => {
    clearEsModuleCache();
    clearEsCompilationCache();
    clearCjsModuleCache();
    clearCjsCompilationCache();
    workerCache.configure(0);
  });

  it('preserves require.resolve.paths on the shimmed require', () => {
    const dir = path.join(
      os.tmpdir(),
      `rstest-require-resolve-paths-${Date.now()}`,
    );
    mkdirSync(dir, { recursive: true });

    const testPath = path.join(dir, 'test.spec.ts');
    const exports = loadModule({
      codeContent: `module.exports = require.resolve.paths('foo');`,
      distPath: path.join(dir, 'bundle.js'),
      testPath,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(exports).toEqual(createRequire(testPath).resolve.paths('foo'));
  });

  it('binds top-level this to exports in CommonJS modules', () => {
    const dir = path.join(os.tmpdir(), `rstest-cjs-this-${Date.now()}`);

    const exports = loadModule({
      codeContent: `this.foo = 'bar';`,
      distPath: path.join(dir, 'bundle.js'),
      testPath: path.join(dir, 'test.spec.ts'),
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(exports).toEqual({ foo: 'bar' });
  });

  it('associates a VM CJS bundle with its external children', () => {
    const testPath = path.resolve(
      __dirname,
      'fixtures/vm-external/module-semantics/parent.cjs',
    );
    const exports = loadModule({
      codeContent:
        'module.exports = { child: require("./child.cjs"), again: require("./child.cjs"), self: module };',
      distPath: testPath,
      testPath,
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
      vmContext: vm.createContext({}),
    });
    expect(exports.child).toMatchObject({
      hasParent: true,
      parentHasChild: true,
    });
    expect(exports.again).toBe(exports.child);
    expect(exports.self.children).toHaveLength(1);
    expect(exports.self.loaded).toBe(true);
  });

  it('keeps the CommonJS wrapper source stable when context parameters change', () => {
    const compileFunctionSpy = rs.spyOn(vm, 'compileFunction');
    onTestFinished(() => {
      compileFunctionSpy.mockRestore();
    });

    const dir = path.join(os.tmpdir(), `rstest-cjs-context-${Date.now()}`);
    const loadOptions = {
      codeContent: `module.exports = 'ok';`,
      distPath: path.join(dir, 'bundle.js'),
      testPath: path.join(dir, 'test.spec.ts'),
      assetFiles: {},
      interopDefault: true,
    };

    loadModule({
      ...loadOptions,
      rstestContext: {},
    });
    const [baseCode, , baseOptions] = compileFunctionSpy.mock.lastCall!;

    loadModule({
      ...loadOptions,
      rstestContext: {
        __rstest_future_context_param__: 'coverage-stability-check',
      },
    });
    const [extraParamCode, extraParamNames, extraParamOptions] =
      compileFunctionSpy.mock.lastCall!;

    expect(extraParamCode).toBe(baseCode);
    expect(extraParamNames).toContain('__rstest_future_context_param__');
    expect(extraParamOptions?.columnOffset).toBe(baseOptions?.columnOffset);
    expect(extraParamOptions?.columnOffset).toBe(0);
    expect(extraParamOptions?.lineOffset).toBe(baseOptions?.lineOffset);
    expect(extraParamOptions?.lineOffset).toBe(-1);
  });

  it('reuses setup compilation data across VM contexts', () => {
    workerCache.configure(1024 * 1024);
    const compileFunctionSpy = rs.spyOn(vm, 'compileFunction');
    onTestFinished(() => {
      compileFunctionSpy.mockRestore();
    });

    const dir = path.join(
      os.tmpdir(),
      `rstest-cjs-compile-cache-${Date.now()}`,
    );
    const loadOptions = {
      codeContent: `module.exports = globalThis;`,
      distPath: path.join(dir, 'setup.js'),
      testPath: path.join(dir, 'test.spec.ts'),
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      cacheCompilation: true,
    };

    loadModule({ ...loadOptions, vmContext: vm.createContext({}) });
    clearCjsModuleCache();
    loadModule({ ...loadOptions, vmContext: vm.createContext({}) });

    const [, , options] = compileFunctionSpy.mock.lastCall!;
    expect(options?.cachedData).toBeInstanceOf(Buffer);
  });

  it('should not reuse CommonJS module instances across VM contexts', () => {
    const dir = path.join(
      os.tmpdir(),
      `rstest-cjs-context-cache-${Date.now()}`,
    );
    const loadOptions = {
      codeContent: 'module.exports = globalThis;',
      distPath: path.join(dir, 'shared.js'),
      testPath: path.join(dir, 'shared.test.ts'),
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    };
    const firstContext = vm.createContext({});
    const secondContext = vm.createContext({});

    const first = loadModule({ ...loadOptions, vmContext: firstContext });
    const second = loadModule({ ...loadOptions, vmContext: secondContext });

    expect(first).not.toBe(second);
    expect(first).toBe(vm.runInContext('globalThis', firstContext));
    expect(second).toBe(vm.runInContext('globalThis', secondContext));
  });

  it('reuses ESM setup compilation data across VM contexts', async () => {
    workerCache.configure(1024 * 1024);
    // @types/node does not declare SourceTextModule.createCachedData yet.
    const modulePrototype = vm.SourceTextModule.prototype as unknown as {
      createCachedData: () => Buffer;
    };
    const originalCreateCachedData = modulePrototype.createCachedData;
    let createCachedDataCalls = 0;
    modulePrototype.createCachedData = function () {
      createCachedDataCalls++;
      return originalCreateCachedData.call(this);
    };
    onTestFinished(() => {
      modulePrototype.createCachedData = originalCreateCachedData;
    });

    const dir = path.join(
      os.tmpdir(),
      `rstest-esm-compile-cache-${Date.now()}`,
    );
    const loadOptions = {
      codeContent: `export const marker = 1;`,
      distPath: path.join(dir, 'setup.mjs'),
      testPath: path.join(dir, 'test.spec.ts'),
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      cacheCompilation: true,
    };

    await loadEsModule({
      ...loadOptions,
      vmContext: vm.createContext({}),
    });
    clearEsModuleCache();
    await loadEsModule({
      ...loadOptions,
      vmContext: vm.createContext({}),
    });

    expect(createCachedDataCalls).toBe(1);
  });

  it('preserves CommonJS stack trace line offsets', () => {
    const dir = path.join(os.tmpdir(), `rstest-cjs-stack-${Date.now()}`);
    const distPath = path.join(dir, 'bundle.js');

    let error: unknown;

    try {
      loadModule({
        codeContent: `throw new Error('line-offset-check');`,
        distPath,
        testPath: path.join(dir, 'test.spec.ts'),
        rstestContext: {},
        assetFiles: {},
        interopDefault: true,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).stack).toContain(`${distPath}:1:7`);
  });
});
