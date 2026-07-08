import { expect, it, rs } from '@rstest/core';
import * as actual from 'cjs-shaped' with { rstest: 'importActual' };
// The helper requires 'sfx-mod' while the importActual external above is
// still pending, so the mock is served through the lazy path.
import fn from './requiresMock.cjs';

rs.mockRequire('sfx-mod', () => () => 'ok');

void actual;

it('should keep a lazily-served mockRequire mock callable', () => {
  expect(fn()).toBe('ok');
  expect((globalThis as any).__RSTEST_SFX_REAL_RAN).toBeUndefined();
});
