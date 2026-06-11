import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import vm from 'node:vm';
import { onTestFinished, rs } from '@rstest/core';
import path from 'pathe';
import {
  clearModuleCache as clearEsModuleCache,
  loadModule as loadEsModule,
} from '../../src/runtime/worker/loadEsModule';
import {
  clearModuleCache as clearCjsModuleCache,
  loadModule,
} from '../../src/runtime/worker/loadModule';

describe('require.resolve origin runtime helper', () => {
  afterEach(() => {
    clearEsModuleCache();
    clearCjsModuleCache();
  });

  it('resolves relative specifiers against injected source module origin', () => {
    const dir = path.join(os.tmpdir(), `rstest-require-resolve-${Date.now()}`);
    const depDir = path.join(dir, 'dist');
    mkdirSync(depDir, { recursive: true });
    writeFileSync(path.join(depDir, 'exportHelper.js'), 'module.exports = {}');

    const testPath = path.join(dir, 'test', 'template.spec.ts');
    const origin = path.join(depDir, 'index.js');
    const exports = loadModule({
      codeContent: `module.exports = __rstest_require_resolve__('./exportHelper', ${JSON.stringify(origin)});`,
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
      codeContent: `module.exports = __rstest_require_resolve__('foo', { paths: [${JSON.stringify(targetDir)}] }, ${JSON.stringify(origin)});`,
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
      codeContent: `export default import.meta.__rstest_require_resolve__('./exportHelper', ${JSON.stringify(origin)});`,
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
