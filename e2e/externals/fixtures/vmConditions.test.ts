import { createRequire } from 'node:module';
import { expect, it } from '@rstest/core';

it('uses native require conditions in the VM', () => {
  const require = createRequire(import.meta.url);
  expect(require('test-vm-external/conditions/entry.cjs')).toEqual(
    JSON.parse(process.env.RSTEST_EXPECTED_REQUIRE_CONDITIONS!),
  );
});
