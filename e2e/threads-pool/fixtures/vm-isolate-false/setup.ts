import { resolveObjectURL } from 'node:buffer';
import { expect } from '@rstest/core';

const previousObjectURL = process.env.RSTEST_VM_PREVIOUS_OBJECT_URL;
if (previousObjectURL) {
  expect(resolveObjectURL(previousObjectURL)).toBeUndefined();
  console.log('VM_OBJECT_URL_REVOKED');
}
const objectURL = URL.createObjectURL(new Blob(['file-scoped']));
expect(resolveObjectURL(objectURL)).toBeDefined();
process.env.RSTEST_VM_PREVIOUS_OBJECT_URL = objectURL;

const setupGlobal = globalThis as typeof globalThis & {
  __RSTEST_VM_SETUP_COUNT__?: number;
};

setupGlobal.__RSTEST_VM_SETUP_COUNT__ =
  (setupGlobal.__RSTEST_VM_SETUP_COUNT__ ?? 0) + 1;
console.log('VM_SETUP_FILE');
