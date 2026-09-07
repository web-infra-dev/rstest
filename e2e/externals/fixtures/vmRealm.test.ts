import { expect, it } from '@rstest/core';
import vm from 'node:vm';
// @ts-expect-error: the package is copied into node_modules by the e2e harness
import * as vmExternal from 'test-vm-external/index.mjs';

const {
  createTimerPromise,
  createStaticTimerPromise,
  inspectRealm,
  inspectLoaderBoundaries,
  inspectCommonJsPaths,
  inspectFailedChild,
  requireAddonGraph,
  importAddonGraph,
  importedImportMetaMain,
  verifyImportAttributeErrorRealm,
  verifyNodeGlobals,
  verifyBuiltinCallback,
  verifyBuiltinSyncError,
  verifyModuleBuiltin,
  verifyProcessGuards,
  verifyUnsupportedImportAttribute,
} = vmExternal;

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
