import { createRequire } from 'node:module';
import { expect, test } from '@rstest/core';

const require = createRequire(import.meta.url);

// With `runtimeTsTransform: false` the hook never registers, so this hits the
// native failure the feature exists to fix. The run is expected to FAIL — that
// is what proves the fixture is a real repro and that the flag gates the hook.
test('fails natively when runtimeTsTransform is disabled', () => {
  expect(require('./plugin.ts')).toEqual({ name: 'cjs-plugin' });
});
