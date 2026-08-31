import { expect, it } from '@rstest/core';
import vm from 'node:vm';
// @ts-expect-error: the package is copied into node_modules by the e2e harness
import * as vmExternal from 'test-vm-external/index.mjs';

const { inspectRealm, verifyNodeGlobals, verifyUnsupportedImportAttribute } =
  vmExternal;

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
  });
  expect(await verifyUnsupportedImportAttribute()).toBe(
    'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
  );
  await expect(verifyNodeGlobals()).resolves.toEqual({
    blobSize: 4,
    blobText: 'blob',
    clonedBlob: true,
    fetchPromise: true,
    responseText: 'vm',
    structuredCloneNestedObject: true,
    structuredCloneObject: true,
  });
});
