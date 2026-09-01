import { expect, it } from '@rstest/core';
import vm from 'node:vm';
// @ts-expect-error: the package is copied into node_modules by the e2e harness
import * as vmExternal from 'test-vm-external/index.mjs';

const {
  createTimerPromise,
  createStaticTimerPromise,
  inspectRealm,
  importedImportMetaMain,
  verifyNodeGlobals,
  verifyUnsupportedImportAttribute,
} = vmExternal;

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
  expect(await verifyUnsupportedImportAttribute()).toBe(
    'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
  );
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
    responseText: 'vm',
    structuredCloneNestedObject: true,
    structuredCloneObject: true,
  });
});
