import { expect, it } from '@rstest/core';
import vm from 'node:vm';
// @ts-expect-error: the package is copied into node_modules by the e2e harness
import { inspectRealm } from 'test-vm-external/index.mjs';

it('executes external modules in the test VM realm', () => {
  expect(inspectRealm({ from: 'vm' })).toEqual({
    commonJs: true,
    esm: true,
    filename: 'index.mjs',
    dataUrls: { javascript: 'data-js', json: 1 },
    importedJson: 'external-json',
    plainDefault: { default: 'inner', named: 1 },
    requiredEsm:
      'hasAsyncGraph' in vm.SourceTextModule.prototype
        ? { sameRealm: true, value: 'esm' }
        : { code: 'ERR_REQUIRE_ESM' },
    requiredJson: 'external-json',
    timers: true,
    wasm: 42,
  });
});
