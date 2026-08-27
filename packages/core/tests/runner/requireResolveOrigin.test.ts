import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import vm from 'node:vm';
import { onTestFinished, rs } from '@rstest/core';
import path from 'pathe';
import type { AssetFiles } from '../../src/types';
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
import {
  importMetaHook,
  RSTEST_REQUIRE_RESOLVE_HOOK,
} from '../../src/runtime/worker/runtimeHooks';
import { workerCache } from '../../src/runtime/worker/workerCache';

describe('require.resolve origin runtime helper', () => {
  afterEach(() => {
    clearEsModuleCache();
    clearEsCompilationCache();
    clearCjsModuleCache();
    clearCjsCompilationCache();
    workerCache.configure(0);
  });

  it('resolves relative specifiers against injected source module origin', () => {
    const dir = path.join(os.tmpdir(), `rstest-require-resolve-${Date.now()}`);
    const depDir = path.join(dir, 'dist');
    mkdirSync(depDir, { recursive: true });
    writeFileSync(path.join(depDir, 'exportHelper.js'), 'module.exports = {}');

    const testPath = path.join(dir, 'test', 'template.spec.ts');
    const origin = path.join(depDir, 'index.js');
    const exports = loadModule({
      codeContent: `module.exports = ${RSTEST_REQUIRE_RESOLVE_HOOK}('./exportHelper', ${JSON.stringify(origin)});`,
      distPath: path.join(dir, 'bundle.js'),
      testPath,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(exports).toBe(realpathSync(path.join(depDir, 'exportHelper.js')));
  });

  it('preserves require.resolve options when origin is injected', () => {
    const dir = path.join(
      os.tmpdir(),
      `rstest-require-resolve-options-${Date.now()}`,
    );
    const targetDir = path.join(dir, 'custom-path');
    const packageDir = path.join(targetDir, 'node_modules', 'foo');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ main: 'index.js' }),
    );
    writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {}');

    const origin = path.join(dir, 'src', 'index.js');
    const exports = loadModule({
      codeContent: `module.exports = ${RSTEST_REQUIRE_RESOLVE_HOOK}('foo', { paths: [${JSON.stringify(targetDir)}] }, ${JSON.stringify(origin)});`,
      distPath: path.join(dir, 'bundle.js'),
      testPath: path.join(dir, 'test.spec.ts'),
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(exports).toBe(realpathSync(path.join(packageDir, 'index.js')));
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

  it('preserves fs read contracts for opted-in virtual assets', async () => {
    const virtualFile = path.join(
      os.tmpdir(),
      `rstest-virtual-fs-${Date.now()}`,
      'dist',
      'chunk.js',
    );
    const assetFiles: AssetFiles = {
      [virtualFile]: 'virtual chunk',
    };
    const binaryFile = path.join(path.dirname(virtualFile), 'asset.bin');
    const binaryContent = Buffer.from([0, 0xff, 0x80, 0x41]);
    assetFiles[binaryFile] = binaryContent;
    const loadOptions = {
      codeContent: `
        const fs = require('node:fs');
        module.exports = {
          exists: fs.existsSync(${JSON.stringify(virtualFile)}),
          syncBuffer: fs.existsSync(${JSON.stringify(virtualFile)})
            ? fs.readFileSync(${JSON.stringify(virtualFile)})
            : undefined,
          syncText: fs.existsSync(${JSON.stringify(virtualFile)})
            ? fs.readFileSync(${JSON.stringify(virtualFile)}, 'utf-8')
            : undefined,
          callback: fs.existsSync(${JSON.stringify(virtualFile)})
            ? new Promise((resolve, reject) => {
                fs.readFile(${JSON.stringify(virtualFile)}, (error, content) =>
                  error ? reject(error) : resolve(content),
                );
              })
            : undefined,
          promise: fs.existsSync(${JSON.stringify(virtualFile)})
            ? fs.promises.readFile(${JSON.stringify(virtualFile)}, 'utf-8')
            : undefined,
          binary: fs.existsSync(${JSON.stringify(binaryFile)})
            ? fs.readFileSync(${JSON.stringify(binaryFile)})
            : undefined,
          binaryText: fs.existsSync(${JSON.stringify(binaryFile)})
            ? fs.readFileSync(${JSON.stringify(binaryFile)}, 'utf8')
            : undefined,
          mutatedBinary: fs.existsSync(${JSON.stringify(binaryFile)})
            ? (() => {
                const content = fs.readFileSync(${JSON.stringify(binaryFile)});
                content[0] = 42;
                return content;
              })()
            : undefined,
          binaryAfterMutation: fs.existsSync(${JSON.stringify(binaryFile)})
            ? fs.readFileSync(${JSON.stringify(binaryFile)})
            : undefined,
        };
      `,
      distPath: path.join(os.tmpdir(), `rstest-virtual-fs-${Date.now()}.js`),
      testPath: path.join(
        os.tmpdir(),
        `rstest-virtual-fs-${Date.now()}.test.ts`,
      ),
      rstestContext: {},
      assetFiles,
      interopDefault: true,
    };

    expect(loadModule(loadOptions)).toEqual({
      exists: false,
      syncBuffer: undefined,
      syncText: undefined,
      callback: undefined,
      promise: undefined,
      binary: undefined,
      binaryText: undefined,
      mutatedBinary: undefined,
      binaryAfterMutation: undefined,
    });
    const virtual = loadModule({
      ...loadOptions,
      virtualFsAssetFiles: assetFiles,
    });
    expect(virtual.exists).toBe(true);
    expect(Buffer.isBuffer(virtual.syncBuffer)).toBe(true);
    expect(virtual.syncBuffer.toString()).toBe('virtual chunk');
    expect(virtual.syncText).toBe('virtual chunk');
    expect(Buffer.isBuffer(await virtual.callback)).toBe(true);
    expect(await virtual.promise).toBe('virtual chunk');
    expect(Buffer.isBuffer(virtual.binary)).toBe(true);
    expect(virtual.binary).toEqual(binaryContent);
    expect(virtual.binaryText).toBe('\0\ufffd\ufffdA');
    expect(virtual.mutatedBinary).toEqual(Buffer.from([42, 0xff, 0x80, 0x41]));
    expect(virtual.binaryAfterMutation).toEqual(binaryContent);
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

  it('attaches the helper to import.meta in esm mode', async () => {
    const dir = path.join(
      os.tmpdir(),
      `rstest-require-resolve-esm-${Date.now()}`,
    );
    const depDir = path.join(dir, 'dist');
    mkdirSync(depDir, { recursive: true });
    writeFileSync(path.join(depDir, 'exportHelper.js'), 'module.exports = {}');

    const origin = path.join(depDir, 'index.mjs');
    const mod = await loadEsModule({
      codeContent: `export default ${importMetaHook(RSTEST_REQUIRE_RESOLVE_HOOK)}('./exportHelper', ${JSON.stringify(origin)});`,
      distPath: path.join(dir, 'bundle.mjs'),
      testPath: path.join(dir, 'test.spec.ts'),
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    });

    expect(mod.default).toBe(
      realpathSync(path.join(depDir, 'exportHelper.js')),
    );
  });
});
