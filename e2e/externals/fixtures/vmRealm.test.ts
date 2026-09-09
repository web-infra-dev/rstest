import { expect, it } from '@rstest/core';
import vm from 'node:vm';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: the package is copied into node_modules by the e2e harness
import * as vmExternal from 'test-vm-external/index.mjs';

const {
  createTimerPromise,
  createStaticTimerPromise,
  inspectRealm,
  inspectLoaderBoundaries,
  inspectCommonJsPaths,
  inspectCreateRequireParent,
  inspectCommonJsGetters,
  inspectFailedChild,
  requireAddonGraph,
  importAddonGraph,
  importMissingDependency,
  importedImportMetaMain,
  verifyImportAttributeErrorRealm,
  verifyNodeGlobals,
  verifyBuiltinCallback,
  verifyBuiltinSyncError,
  verifyModuleBuiltin,
  verifyProcessGuards,
  verifyUnsupportedImportAttribute,
} = vmExternal;

it('uses the file require cache through Module._cache and keeps compile errors in the VM', () => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'rstest-vm-module-cache-')),
  );
  try {
    const child = join(directory, 'child.cjs');
    const invalid = join(directory, 'invalid.cjs');
    const json = join(directory, 'data.json');
    writeFileSync(child, 'module.exports = {};');
    writeFileSync(invalid, 'module.exports = ;');
    writeFileSync(json, '{"value":1}');
    const load = createRequire(join(directory, 'parent.cjs'));
    // Node exposes this private alias; accessing it must not reach worker state.
    const cache = Reflect.get(Module, '_cache');
    expect(cache).toBe(load.cache);
    expect(Object.getOwnPropertyDescriptor(Module, '_cache')?.value).toBe(
      cache,
    );
    expect(Reflect.set(Module, '_cache', {})).toBe(false);
    expect(Reflect.defineProperty(Module, '_cache', { value: {} })).toBe(false);
    expect(Reflect.deleteProperty(Module, '_cache')).toBe(false);
    const first = load(child);
    expect(cache[child].exports).toBe(first);
    delete cache[child];
    expect(load(child)).not.toBe(first);
    const firstJson = load(json);
    expect(cache[json].exports).toBe(firstJson);
    delete cache[json];
    expect(load(json)).not.toBe(firstJson);
    expect(() => load(invalid)).toThrow(SyntaxError);
    expect(() => load(invalid)).toThrow(Error);
    expect(load.cache[invalid]).toBeUndefined();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('reports malformed data URLs as VM TypeErrors', async () => {
  await expect(
    importMissingDependency('data:text/javascript;base64,%%%'),
  ).rejects.toThrow(TypeError);
  await expect(
    importMissingDependency('data:text/javascript;base64,%%%'),
  ).rejects.toMatchObject({ code: 'ERR_INVALID_URL' });
});

it('gives createRequire in external ESM a stable synthetic parent', () => {
  expect(inspectCreateRequireParent()).toEqual({
    filename: true,
    linked: true,
    repeated: true,
    children: 1,
    parentRequire: true,
    jsonChildLinked: true,
  });
});

it('snapshots CJS named getters using the original exports receiver', async () => {
  expect(await inspectCommonJsGetters()).toEqual({
    before: [43, 43, 43],
    after: [43, 43, 44],
    sameDefault: true,
    gettersReadOnce: true,
  });
});

it.each(['missing-rstest-vm-dependency', '@rstest/missing-vm-dependency'])(
  'creates external dynamic import resolution errors in the VM: %s',
  async (specifier) => {
    await expect(importMissingDependency(specifier)).rejects.toThrow(Error);
    await expect(importMissingDependency(specifier)).rejects.toMatchObject({
      code: 'ERR_MODULE_NOT_FOUND',
    });
  },
);

it('rejects native addon imports in synchronous and asynchronous ESM graphs', async () => {
  expect(requireAddonGraph).toThrow(
    expect.objectContaining({
      code:
        'hasAsyncGraph' in vm.SourceTextModule.prototype
          ? 'ERR_UNKNOWN_FILE_EXTENSION'
          : 'ERR_REQUIRE_ESM',
    }),
  );
  try {
    requireAddonGraph();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
  }
  await expect(importAddonGraph()).rejects.toSatisfy((error) => {
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: 'ERR_UNKNOWN_FILE_EXTENSION' });
    return true;
  });
});

it('removes failed CommonJS children before a retry', () => {
  expect(inspectFailedChild()).toEqual({
    failed: true,
    cachedAfterFailure: false,
    childrenAfterFailure: 0,
    childrenAfterRetry: 1,
    result: 'retried',
  });
});

it('executes external modules in the test VM realm', async () => {
  expect(inspectRealm({ from: 'vm' })).toEqual({
    commonJs: true,
    esm: true,
    filename: 'index.mjs',
    dataUrls: {
      javascript: 'data-js',
      javascriptApplication: 'application-data-js',
      json: 1,
    },
    importedJson: 'external-json',
    jsonSameObject: true,
    nonEnumerableValue: 42,
    plainDefault: { default: 'inner', named: 1 },
    requiredEsm:
      'hasAsyncGraph' in vm.SourceTextModule.prototype
        ? { esModule: false, sameRealm: true, value: 'esm' }
        : { code: 'ERR_REQUIRE_ESM' },
    requiredJson: 'external-json',
    timers: true,
    builtinSync: true,
    wasm: 42,
    wasmFunction: true,
  });
  // Callback arguments and synchronous native throws retain their host realm.
  await expect(verifyBuiltinCallback()).resolves.toEqual({
    isVmError: false,
    code: 'ENOENT',
  });
  expect(verifyBuiltinSyncError()).toEqual({
    isVmError: false,
    code: 'ENOENT',
  });
  expect(verifyModuleBuiltin()).toEqual({
    builtinModulesArray: true,
    builtinModulesObject: true,
    commonJsArray: true,
    moduleClassArray: true,
    sameArray: true,
    sameDefault: true,
    functionIsProxy: false,
  });
  expect(await verifyUnsupportedImportAttribute()).toBe(
    'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
  );
  expect(await verifyImportAttributeErrorRealm()).toBe(true);
  expect(verifyProcessGuards()).toEqual({
    killGuarded: true,
    exitGuarded: true,
  });
  expect(inspectCommonJsPaths().dirname).toBe(inspectCommonJsPaths().expected);
  const timerPromise = createTimerPromise();
  expect(timerPromise).toBeInstanceOf(Promise);
  await expect(timerPromise).resolves.toBe('timer');
  const staticTimerPromise = createStaticTimerPromise();
  expect(staticTimerPromise).toBeInstanceOf(Promise);
  await expect(staticTimerPromise).resolves.toBe('static-timer');
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const supportsImportMetaMain =
    major > 24 ||
    (major === 24 && minor >= 2) ||
    major === 23 ||
    (major === 22 && minor >= 18);
  expect(importedImportMetaMain).toEqual({
    supported: supportsImportMetaMain,
    value: supportsImportMetaMain ? false : undefined,
  });
  await expect(verifyNodeGlobals()).resolves.toEqual({
    blobSize: 4,
    blobText: 'blob',
    clonedBlob: true,
    clonedTypeError: true,
    clonedTypeErrorName: 'TypeError',
    clonedErrorCause: true,
    clonedTypedArray: true,
    clonedTypedArrayBuffer: true,
    fetchPromise: true,
    fetchError: true,
    responseText: 'vm',
    structuredCloneNestedObject: true,
    structuredCloneObject: true,
  });
});

it('loads ambiguous ESM, legacy CommonJS and percent-containing data URLs', async () => {
  await expect(inspectLoaderBoundaries()).resolves.toEqual({
    ambiguousKeys: ['value'],
    ambiguousValue: 'syntax-detected-esm',
    legacyValue: 1,
    legacySame: true,
    dataModulo: 1,
    dataUnicode: '汉%',
    dataBase64: { javascript: 1, json: 1, wasmExports: [] },
  });
});
