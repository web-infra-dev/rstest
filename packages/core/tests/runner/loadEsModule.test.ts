import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { asModule } from '../../src/runtime/worker/interop';
import {
  appendSourceURL,
  clearModuleCache,
  loadModule,
  shouldInjectSourceURL,
} from '../../src/runtime/worker/loadEsModule';
import {
  clearVmExternalCompilationCache,
  disposeVmExternalModules,
  getVmExternalModules,
} from '../../src/runtime/worker/vm/externalModules';
import { resolveExternalSpecifier } from '../../src/runtime/worker/vm/externalModuleCache';
import { workerCache } from '../../src/runtime/worker/vm/cache';

// cspell:ignore QEAAAA extensionless

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) => resolve(__dirname, 'fixtures', name);

describe('loadEsModule', () => {
  afterEach(() => {
    clearModuleCache();
  });

  it('canonicalizes bare builtin external imports', () => {
    expect(resolveExternalSpecifier('fs', __filename)).toBe('node:fs');
    expect(resolveExternalSpecifier('node:fs', __filename)).toBe('node:fs');
  });

  it('should link nested modules that statically import builtins', async () => {
    const testPath = '/virtual/tests/runtime.test.ts';
    const distPath = '/virtual/dist/entry.mjs';
    const chunkPath = '/virtual/dist/chunk.mjs';

    const mod = await loadModule({
      codeContent: [
        "import chunk, { separator } from './chunk.mjs';",
        'export default {',
        '  hasReadFile: chunk,',
        '  separator,',
        '};',
      ].join('\n'),
      distPath,
      testPath,
      rstestContext: {},
      assetFiles: {
        [chunkPath]: [
          "import fs from 'node:fs';",
          "import path from 'node:path';",
          'export const separator = path.sep;',
          "export default typeof fs.readFile === 'function';",
        ].join('\n'),
      },
      interopDefault: false,
    });

    expect(mod.default).toEqual({
      hasReadFile: true,
      separator: sep,
    });
  });

  it('should append sourceURL for esm vm execution', () => {
    expect(appendSourceURL("throw new Error('x')", '/virtual/dist/entry.mjs'))
      .toMatchInlineSnapshot(`
      "throw new Error('x')
      //# sourceURL=/virtual/dist/entry.mjs"
    `);
  });

  it('should not duplicate an existing sourceURL comment', () => {
    const code = [
      "throw new Error('x')",
      '//# sourceURL=/virtual/dist/original.mjs',
    ].join('\n');

    expect(appendSourceURL(code, '/virtual/dist/entry.mjs')).toBe(code);
  });

  // Regression: native ESM modules with only named exports (no `export default`)
  // must not grow a phantom `default` key after being wrapped by asModule.
  // Refs: rslib ecosystem-ci failures on rstest PR #1171 — snapshots of
  // `import * as m from '<esm-named-only>'` gained a self-referential
  // `default: namespace` key because the asModule wrap synthesized one via
  // `something['default'] ?? something`.
  it('should not synthesize a phantom default when the source has only named exports', async () => {
    const namespace = { foo: 'foo-val', bar: 'bar-val' };
    const sm = await asModule(namespace, '/fake/id/named-only');

    expect(Object.keys(sm.namespace).sort()).toEqual(['bar', 'foo']);
    expect('default' in sm.namespace).toBe(false);
  });

  it('should expose the real default export when the source has both default and named exports', async () => {
    const defaultVal = { marker: 'real-default' };
    const namespace = { default: defaultVal, foo: 'foo-val' };
    const sm = await asModule(namespace, '/fake/id/default-and-named');

    expect(Object.keys(sm.namespace).sort()).toEqual(['default', 'foo']);
    const namespaceExports = sm.namespace as Record<string, unknown>;
    expect(namespaceExports.default).toBe(defaultVal);
    expect(namespaceExports.foo).toBe('foo-val');
  });

  it('should reuse the cached SyntheticModule for the same resolved id', async () => {
    const sm1 = await asModule({ foo: 'a' }, '/cache/shared');
    const sm2 = await asModule({ bar: 'b' }, '/cache/shared');

    expect(sm2).toBe(sm1);
  });

  it('should not reuse ESM module instances across VM contexts', async () => {
    const loadOptions = {
      codeContent: 'export default globalThis;',
      distPath: '/virtual/dist/shared.mjs',
      testPath: '/virtual/tests/shared.test.ts',
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
    };
    const firstContext = vm.createContext({});
    const secondContext = vm.createContext({});

    const first = await loadModule({ ...loadOptions, vmContext: firstContext });
    const second = await loadModule({
      ...loadOptions,
      vmContext: secondContext,
    });

    expect(first.default).not.toBe(second.default);
    expect(first.default).toBe(vm.runInContext('globalThis', firstContext));
    expect(second.default).toBe(vm.runInContext('globalThis', secondContext));
  });

  it('should evaluate external modules in the provided VM context', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath('vm-external/index.mjs');
    const mod = await loadModule({
      codeContent: [
        `import { inspectRealm } from ${JSON.stringify(externalPath)};`,
        'export default inspectRealm({ from: "vm" });',
      ].join('\n'),
      distPath: '/virtual/dist/external-entry.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toEqual({
      commonJs: true,
      esm: true,
      filename: 'index.mjs',
      importedJson: 'fixture-json',
      requiredJson: 'fixture-json',
    });
  });

  it('should bind external timers imports to the VM global', async () => {
    const vmTimeout = () => {};
    const vmContext = vm.createContext({ setTimeout: vmTimeout });
    const externalPath = fixturePath('vm-external/timers.mjs');
    const mod = await loadModule({
      codeContent: [
        `import { inspectTimers } from ${JSON.stringify(externalPath)};`,
        'export default inspectTimers();',
      ].join('\n'),
      distPath: '/virtual/dist/external-timers.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toEqual({ defaultExport: true, namedExport: true });
  });

  it('should expose Node CommonJS module relationships inside the VM', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath('vm-external/module-semantics/parent.cjs');
    const mod = await loadModule({
      codeContent: [
        `import semantics from ${JSON.stringify(externalPath)};`,
        'export default semantics;',
      ].join('\n'),
      distPath: '/virtual/dist/commonjs-semantics.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toEqual({
      cachedBeforeDelete: true,
      first: {
        cacheDescriptorMatches: true,
        cachedDuringExecution: true,
        hasLookupPaths: true,
        hasParent: true,
        parentHasChild: true,
      },
      injected: { fromCache: true },
      originalJson: 'fixture-json',
      replaced: { replaced: true },
      replacedJson: 'replaced-json',
      reloadedAfterDelete: true,
      second: {
        cacheDescriptorMatches: true,
        cachedDuringExecution: true,
        hasLookupPaths: true,
        hasParent: true,
        parentHasChild: true,
      },
      moduleConstructor: {
        hasLoad: true,
        hasResolveFilename: true,
        isModule: true,
        sameConstructor: true,
      },
    });
  });

  it('should reject ESM imports of native addons', async () => {
    const vmContext = vm.createContext({});
    const executor = getVmExternalModules(vmContext);
    const addonPath = fixturePath(
      'vm-external/module-semantics/native-addon.node',
    );

    await expect(executor.import(addonPath, true, false)).rejects.toMatchObject(
      {
        code: 'ERR_UNKNOWN_FILE_EXTENSION',
      },
    );
  });

  it('should preserve the complete CommonJS value as its default export', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath(
      'vm-external/module-semantics/plain-default.cjs',
    );
    const mod = await loadModule({
      codeContent: [
        `import value from ${JSON.stringify(externalPath)};`,
        'export default value;',
      ].join('\n'),
      distPath: '/virtual/dist/plain-commonjs-default.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toEqual({ default: 'inner', named: 1 });
  });

  it('should expose named exports from CommonJS reexports', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath(
      'vm-external/module-semantics/reexport-import.mjs',
    );
    const mod = await loadModule({
      codeContent: [
        `export { default } from ${JSON.stringify(externalPath)};`,
      ].join('\n'),
      distPath: '/virtual/dist/commonjs-reexport.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toBe('reexported');
  });

  it('should reject named imports that the CommonJS lexer cannot detect', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath(
      'vm-external/module-semantics/invalid-named-import.mjs',
    );
    const executor = getVmExternalModules(vmContext);

    await expect(executor.import(externalPath, true, false)).rejects.toThrow();
  });

  it('should keep CommonJS dynamic imports bound to their VM context', async () => {
    const firstContext = vm.createContext({});
    const externalPath = fixturePath(
      'vm-external/module-semantics/dynamic.cjs',
    );
    const loadOptions = {
      codeContent: [
        `import load from ${JSON.stringify(externalPath)};`,
        'export default load;',
      ].join('\n'),
      distPath: '/virtual/dist/commonjs-dynamic-import.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    };
    const first = await loadModule({
      ...loadOptions,
      vmContext: firstContext,
    });

    await expect(first.default()).resolves.toMatchObject({ value: 'esm' });
    disposeVmExternalModules(firstContext);

    const secondContext = vm.createContext({});
    const second = await loadModule({
      ...loadOptions,
      vmContext: secondContext,
    });
    await expect(first.default()).rejects.toThrow('test context was torn down');
    await expect(second.default()).resolves.toMatchObject({ value: 'esm' });
  });

  it('should load JavaScript, JSON, and WebAssembly data URLs', async () => {
    const vmContext = vm.createContext({});
    const mod = await loadModule({
      codeContent: [
        "import { value } from 'data:text/javascript,export%20const%20value%20=%20%22data-js%22';",
        "import data from 'data:application/json,%7B%22value%22%3A1%7D' with { type: 'json' };",
        "import 'data:application/wasm;base64,AGFzbQEAAAA=';",
        'export default { json: data.value, value };',
      ].join('\n'),
      distPath: '/virtual/dist/data-urls.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toEqual({ json: 1, value: 'data-js' });
  });

  it('should preserve WebAssembly imports when loading an external module', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'rstest-vm-wasm-'));
    const wasmPath = join(temporaryDirectory, 'value.wasm');
    const context = vm.createContext({});
    const wasm = Buffer.from([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 127, 1, 127, 2, 17, 1, 9, 46,
      47, 101, 110, 118, 46, 109, 106, 115, 3, 97, 100, 100, 0, 0, 3, 2, 1, 0,
      7, 7, 1, 3, 114, 117, 110, 0, 1, 10, 8, 1, 6, 0, 32, 0, 16, 0, 11,
    ]);

    try {
      writeFileSync(wasmPath, wasm);
      writeFileSync(
        join(temporaryDirectory, 'env.mjs'),
        'export const add = (value) => value + 1;\n',
      );
      const mod = await loadModule({
        codeContent: [
          `import { run } from ${JSON.stringify(wasmPath)};`,
          'export default run(2);',
        ].join('\n'),
        distPath: '/virtual/dist/external-wasm.mjs',
        testPath: __filename,
        rstestContext: {},
        assetFiles: {},
        interopDefault: true,
        vmContext: context,
      });

      expect(mod.default).toBe(3);
    } finally {
      disposeVmExternalModules(context);
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('should enforce JSON import attributes in the VM loader', async () => {
    const jsonUrl = 'data:application/json,%7B%22value%22%3A1%7D';
    const loadOptions = {
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
    };

    await expect(
      loadModule({
        ...loadOptions,
        distPath: '/virtual/dist/json-attributes-missing.mjs',
        vmContext: vm.createContext({}),
        codeContent: `import value from ${JSON.stringify(jsonUrl)}; export default value;`,
      }),
    ).rejects.toMatchObject({ code: 'ERR_IMPORT_ATTRIBUTE_MISSING' });

    await expect(
      loadModule({
        ...loadOptions,
        distPath: '/virtual/dist/json-attributes-wrong.mjs',
        vmContext: vm.createContext({}),
        codeContent: `import value from ${JSON.stringify(jsonUrl)} with { type: 'javascript' }; export default value;`,
      }),
    ).rejects.toMatchObject({ code: 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED' });
  });

  it('should refresh cached external source after the file changes', async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), 'rstest-vm-external-'),
    );
    const externalPath = join(temporaryDirectory, 'external.mjs');
    const contexts: vm.Context[] = [];
    workerCache.configure(1024 * 1024);

    try {
      writeFileSync(externalPath, "export const value = 'first';\n");
      const firstContext = vm.createContext({});
      contexts.push(firstContext);
      const first = await getVmExternalModules(firstContext).import(
        externalPath,
        true,
        false,
      );
      expect(first).toMatchObject({ value: 'first' });
      disposeVmExternalModules(firstContext);

      writeFileSync(externalPath, "export const value = 'second';\n");
      const secondContext = vm.createContext({});
      contexts.push(secondContext);
      const second = await getVmExternalModules(secondContext).import(
        externalPath,
        true,
        false,
      );
      expect(second).toMatchObject({ value: 'second' });
    } finally {
      for (const context of contexts) {
        disposeVmExternalModules(context);
      }
      clearVmExternalCompilationCache();
      workerCache.configure(0);
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it('should evaluate require(esm) inside the VM realm when Node supports it', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath(
      'vm-external/module-semantics/require-esm.cjs',
    );
    const mod = await loadModule({
      codeContent: [
        `import result from ${JSON.stringify(externalPath)};`,
        'export default result;',
      ].join('\n'),
      distPath: '/virtual/dist/require-esm.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toEqual(
      'hasAsyncGraph' in vm.SourceTextModule.prototype
        ? {
            bridgeValue: 'nested-require-esm',
            code: undefined,
            commonJsValue: 'commonjs',
            cycle: ['b:c', 'c'],
            filename: 'dependency.mjs',
            jsonLabel: 'fixture-json',
            jsonSameRealm: true,
            loadDynamic: expect.anything(),
            sameNamespace: true,
            sameRealm: true,
            esModule: false,
            state: expect.anything(),
            value: 'esm',
          }
        : { code: 'ERR_REQUIRE_ESM' },
    );

    if ('hasAsyncGraph' in vm.SourceTextModule.prototype) {
      const executor = getVmExternalModules(vmContext);
      const imported = await executor.import(
        fixturePath('vm-external/module-semantics/dependency.mjs'),
        true,
        false,
      );
      expect((imported as { state: object }).state).toBe(mod.default.state);

      const importFirstPath = fixturePath(
        'vm-external/module-semantics/import-first.mjs',
      );
      const dynamicallyImported = await mod.default.loadDynamic();
      const importedFirst = await executor.import(importFirstPath, true, false);
      const requiredSecond = executor.require(importFirstPath, __filename);
      expect(dynamicallyImported.state).toBe(
        (importedFirst as { state: object }).state,
      );
      expect((requiredSecond as { state: object }).state).toBe(
        (importedFirst as { state: object }).state,
      );

      const namedOnly = executor.require(
        fixturePath('vm-external/module-semantics/named-only.mjs'),
        __filename,
      );
      expect(namedOnly).toMatchObject({ value: 'named-only' });
      expect(namedOnly).not.toHaveProperty('__esModule');
    }
  });

  it('loads extensionless CommonJS require targets in module packages', () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath(
      'vm-external/module-semantics/explicit-esm/require-extensionless.cjs',
    );
    const executor = getVmExternalModules(vmContext);

    expect(executor.require(externalPath, __filename)).toEqual({
      value: 'extensionless-commonjs',
    });
  });

  it('should require syntax-compatible .js as ESM in a module package', () => {
    const vmContext = vm.createContext({});
    const executor = getVmExternalModules(vmContext);
    const explicitEsmPath = fixturePath(
      'vm-external/module-semantics/explicit-esm/value.js',
    );

    if ('hasAsyncGraph' in vm.SourceTextModule.prototype) {
      executor.require(explicitEsmPath, __filename);
      expect(
        vm.runInContext('globalThis.__RSTEST_EXPLICIT_ESM__', vmContext),
      ).toBe('esm');
    } else {
      expect(() => executor.require(explicitEsmPath, __filename)).toThrow(
        expect.objectContaining({ code: 'ERR_REQUIRE_ESM' }),
      );
    }
  });

  it('should not reinterpret explicit CommonJS .js as ESM after a syntax error', () => {
    const vmContext = vm.createContext({});
    const executor = getVmExternalModules(vmContext);
    const explicitCommonJsPath = fixturePath(
      'vm-external/module-semantics/explicit-commonjs/value.js',
    );

    expect(() => executor.require(explicitCommonJsPath, __filename)).toThrow(
      /Unexpected token/,
    );
  });

  it('should reject require(esm) when its graph uses top-level await', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath(
      'vm-external/module-semantics/require-async-esm.cjs',
    );
    const mod = await loadModule({
      codeContent: [
        `import result from ${JSON.stringify(externalPath)};`,
        'export default result.code;',
      ].join('\n'),
      distPath: '/virtual/dist/require-async-esm.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toBe(
      'hasAsyncGraph' in vm.SourceTextModule.prototype
        ? 'ERR_REQUIRE_ASYNC_MODULE'
        : 'ERR_REQUIRE_ESM',
    );

    if ('hasAsyncGraph' in vm.SourceTextModule.prototype) {
      const executor = getVmExternalModules(vmContext);
      const asyncModulePath = fixturePath(
        'vm-external/module-semantics/async-dependency.mjs',
      );
      const imported = await executor.import(asyncModulePath, true, false);
      expect(imported).toMatchObject({ value: 'async-esm' });
      let requireError: unknown;
      try {
        executor.require(asyncModulePath, __filename);
      } catch (error) {
        requireError = error;
      }
      expect(requireError).toMatchObject({ code: 'ERR_REQUIRE_ASYNC_MODULE' });
    }
  });

  it('should honor the module.exports ESM interop export', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath(
      'vm-external/module-semantics/require-module-exports.cjs',
    );
    const mod = await loadModule({
      codeContent: [
        `import result from ${JSON.stringify(externalPath)};`,
        'export default result;',
      ].join('\n'),
      distPath: '/virtual/dist/require-module-exports.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toEqual(
      'hasAsyncGraph' in vm.SourceTextModule.prototype
        ? { customized: true }
        : { code: 'ERR_REQUIRE_ESM' },
    );
  });

  it('should retry an ambiguous .js file as ESM after CJS parsing fails', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath(
      'vm-external/module-semantics/ambiguous/require.cjs',
    );
    const mod = await loadModule({
      codeContent: [
        `import result from ${JSON.stringify(externalPath)};`,
        'export default result.value;',
      ].join('\n'),
      distPath: '/virtual/dist/require-ambiguous-esm.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toBe(
      'hasAsyncGraph' in vm.SourceTextModule.prototype
        ? 'syntax-detected-esm'
        : undefined,
    );
  });

  it('should select module-sync only when synchronous VM ESM is supported', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath('bare-parent/bare-parent-pkg/index.mjs');
    const mod = await loadModule({
      codeContent: [
        `import { condition as result } from ${JSON.stringify(externalPath)};`,
        'export default { code: result.code, value: result.value };',
      ].join('\n'),
      distPath: '/virtual/dist/require-condition.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toEqual(
      'hasAsyncGraph' in vm.SourceTextModule.prototype
        ? { code: undefined, value: 'module-sync-esm' }
        : Number(process.versions.node.split('.')[0]) >= 22
          ? { code: undefined, value: 'require-commonjs' }
          : { code: 'ERR_REQUIRE_ESM', value: undefined },
    );
  });

  it('should cache require(esm) evaluation errors', async () => {
    if (!('hasAsyncGraph' in vm.SourceTextModule.prototype)) {
      return;
    }
    const vmContext = vm.createContext({});
    const executor = getVmExternalModules(vmContext);
    const externalPath = fixturePath('vm-external/module-semantics/throws.mjs');

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => executor.require(externalPath, __filename)).toThrow(
        'sync esm evaluation failed',
      );
    }
    await expect(executor.import(externalPath, true, false)).rejects.toThrow(
      'sync esm evaluation failed',
    );
  });

  it('should await concurrent links to the same external ESM graph', async () => {
    const vmContext = vm.createContext({});
    const externalPath = fixturePath('vm-external/index.mjs');
    const loadExternal = (name: string) =>
      loadModule({
        codeContent: [
          `import { inspectRealm } from ${JSON.stringify(externalPath)};`,
          `export default inspectRealm({ from: ${JSON.stringify(name)} });`,
        ].join('\n'),
        distPath: `/virtual/dist/${name}.mjs`,
        testPath: __filename,
        rstestContext: {},
        assetFiles: {},
        interopDefault: true,
        vmContext,
      });

    const [first, second] = await Promise.all([
      loadExternal('first'),
      loadExternal('second'),
    ]);

    expect(first.default.esm).toBe(true);
    expect(second.default.esm).toBe(true);
  });

  it('should await a shared dependency linked through concurrent parents', async () => {
    const vmContext = vm.createContext({});
    const loadParent = (name: 'left' | 'right') =>
      loadModule({
        codeContent: [
          `import { ${name} } from ${JSON.stringify(fixturePath(`vm-external/diamond/${name}.mjs`))};`,
          `export default ${name};`,
        ].join('\n'),
        distPath: `/virtual/dist/diamond-${name}.mjs`,
        testPath: __filename,
        rstestContext: {},
        assetFiles: {},
        interopDefault: true,
        vmContext,
      });

    const [left, right] = await Promise.all([
      loadParent('left'),
      loadParent('right'),
    ]);

    expect(left.default).toBe(true);
    expect(right.default).toBe(true);
  });

  it('should link a cycle reached through sibling branches', async () => {
    const vmContext = vm.createContext({});
    const fixture = (name: string) =>
      JSON.stringify(fixturePath(`vm-external/cross-cycle/${name}.mjs`));
    const mod = await loadModule({
      codeContent: [
        `import { fromB } from ${fixture('b')};`,
        `import { throughD } from ${fixture('c')};`,
        'export default [fromB(), throughD()];',
      ].join('\n'),
      distPath: '/virtual/dist/cross-branch-cycle.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: true,
      vmContext,
    });

    expect(mod.default).toEqual(['b:c', 'c']);
  });

  it('should serialize concurrent dynamic imports of cyclic roots', async () => {
    const vmContext = vm.createContext({});
    const executor = getVmExternalModules(vmContext);

    const [fromB, fromC] = await Promise.all([
      executor.import(
        fixturePath('vm-external/cross-cycle/b.mjs'),
        true,
        false,
      ),
      executor.import(
        fixturePath('vm-external/cross-cycle/c.mjs'),
        true,
        false,
      ),
    ]);

    expect((fromB as { fromB: () => string }).fromB()).toBe('b:c');
    expect((fromC as { throughD: () => string }).throughD()).toBe('c');
  });

  it('should reject unsupported external formats instead of host-evaluating them', async () => {
    const vmContext = vm.createContext({});
    const executor = getVmExternalModules(vmContext);

    await expect(
      executor.import(
        fixturePath('vm-external/module-semantics/unsupported.custom'),
        true,
        false,
      ),
    ).rejects.toMatchObject({ code: 'ERR_UNKNOWN_FILE_EXTENSION' });
  });

  it('should not pollute the namespace of a real native ESM module with only named exports', async () => {
    const mod = await loadModule({
      codeContent: [
        `import * as m from ${JSON.stringify(fixturePath('namedOnly.mjs'))};`,
        'export default m;',
      ].join('\n'),
      distPath: '/virtual/dist/entry.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
    });

    expect(Object.keys(mod.default).sort()).toEqual(['bar', 'foo']);
    expect('default' in mod.default).toBe(false);
    expect(mod.default.foo).toBe('foo-val');
    expect(mod.default.bar).toBe('bar-val');
  });

  it('should resolve external ESM after Node native TypeScript loader is used', async () => {
    await import(fixturePath('nativeTsLoader.ts'));

    const mod = await loadModule({
      codeContent: [
        `import { foo } from ${JSON.stringify(fixturePath('namedOnly.mjs'))};`,
        'export default foo;',
      ].join('\n'),
      distPath: '/virtual/dist/entry.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
    });

    expect(mod.default).toBe('foo-val');
  });

  it('should resolve bare static imports from the test path', async () => {
    const testPath = fixturePath('bare-parent/index.test.ts');
    const distPath = '/virtual/dist/.rstest-temp/bare-parent_index~test~ts.mjs';

    const mod = await loadModule({
      codeContent: [
        "import { value } from '#fixture-pkg';",
        'export default value;',
      ].join('\n'),
      distPath,
      testPath,
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
    });

    expect(mod.default).toBe('fixture-pkg-value');
  });

  it('should preserve the real default export of a real native ESM module', async () => {
    const mod = await loadModule({
      codeContent: [
        `import * as m from ${JSON.stringify(fixturePath('defaultAndNamed.mjs'))};`,
        'export default m;',
      ].join('\n'),
      distPath: '/virtual/dist/entry.mjs',
      testPath: __filename,
      rstestContext: {},
      assetFiles: {},
      interopDefault: false,
    });

    expect(Object.keys(mod.default).sort()).toEqual(['default', 'foo']);
    expect(mod.default.default).toEqual({ marker: 'real-default' });
    expect(mod.default.foo).toBe('foo-val');
  });

  // Regression: https://github.com/web-infra-dev/rstest/issues/1376
  // Under `isolate: false` the pool has no environment affinity, so a reused
  // worker can serve project A, then B, then A again. `clearModuleCache(keep)`
  // must accumulate every project's runtime chunk — keeping only the latest id
  // would let B's teardown evict A's runtime chunk and re-evaluate A's shared
  // modules on its next file.
  it('keeps every reused project runtime chunk across files', async () => {
    const g = globalThis as Record<string, any>;
    g.__evalA = 0;
    g.__evalB = 0;
    g.__evalEntry = 0;

    const runtimeA = '/virtual/dist/runtimeA.mjs';
    const runtimeB = '/virtual/dist/runtimeB.mjs';
    const entry = '/virtual/dist/entry.mjs';

    // Each module bumps its global counter when its body runs, so a cached
    // (kept) module returns the same `default` while an evicted one re-runs.
    const load = (distPath: string, counter: string) =>
      loadModule({
        codeContent: [
          `globalThis.${counter} += 1;`,
          `export default globalThis.${counter};`,
        ].join('\n'),
        distPath,
        testPath: distPath,
        rstestContext: {},
        assetFiles: {},
        interopDefault: false,
      });

    // Project A's first file: load its runtime chunk and a (never-kept) entry.
    await load(runtimeA, '__evalA');
    await load(entry, '__evalEntry');
    clearModuleCache(runtimeA);

    // Project B runs on the same worker; its teardown must NOT evict A.
    await load(runtimeB, '__evalB');
    clearModuleCache(runtimeB);

    // Project A's next file: its runtime chunk is still cached (state shared),
    // while the entry — never kept — was re-evaluated.
    expect((await load(runtimeA, '__evalA')).default).toBe(1);
    expect((await load(runtimeB, '__evalB')).default).toBe(1);
    expect((await load(entry, '__evalEntry')).default).toBe(2);

    delete g.__evalA;
    delete g.__evalB;
    delete g.__evalEntry;
  });

  it('should only inject sourceURL in Bun runtime', async () => {
    const originalBunVersion = process.versions.bun;

    try {
      Reflect.deleteProperty(process.versions, 'bun');
      expect(shouldInjectSourceURL()).toBe(false);

      process.versions.bun = originalBunVersion ?? '1.0.0';
      expect(shouldInjectSourceURL()).toBe(true);
    } finally {
      if (originalBunVersion === undefined) {
        Reflect.deleteProperty(process.versions, 'bun');
      } else {
        process.versions.bun = originalBunVersion;
      }
    }
  });
});
