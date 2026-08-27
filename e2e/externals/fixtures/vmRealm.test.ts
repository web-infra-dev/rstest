import { expect, it } from '@rstest/core';
// @ts-expect-error: the package is copied into node_modules by the e2e harness
import { inspectRealm } from 'test-interop/realm.mjs';

it('executes external modules in the test VM realm', () => {
  expect(inspectRealm({ from: 'vm' })).toEqual({
    commonJs: true,
    esm: true,
    filename: 'realm.mjs',
    importedJson: 'external-json',
    requiredJson: 'external-json',
  });
});
