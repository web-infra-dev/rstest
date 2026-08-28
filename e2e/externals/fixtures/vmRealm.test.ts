import { expect, it } from '@rstest/core';
import vm from 'node:vm';
// @ts-expect-error: the package is copied into node_modules by the e2e harness
import { inspectRealm } from 'test-interop/realm.mjs';

it('executes external modules in the test VM realm', () => {
  expect(inspectRealm({ from: 'vm' })).toEqual({
    commonJs: true,
    esm: true,
    filename: 'realm.mjs',
    dataUrls: { javascript: 'data-js', json: 1 },
    importedJson: 'external-json',
    moduleSemantics: {
      first: { cached: true, hasParent: true, parentHasChild: true },
      originalJson: 'original-json',
      replaced: { replaced: true },
      replacedJson: 'replaced-json',
      reloaded: true,
      second: { cached: true, hasParent: true, parentHasChild: true },
    },
    plainDefault: { default: 'inner', named: 1 },
    requiredEsm:
      'hasAsyncGraph' in vm.SourceTextModule.prototype
        ? { explicitEsm: 'esm', sameRealm: true, value: 'esm' }
        : { code: 'ERR_REQUIRE_ESM' },
    requiredJson: 'external-json',
    siblingCycle: ['b:c', 'c'],
    timers: true,
    wasm: 42,
  });
});
