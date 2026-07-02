import { describe, expect, rs, test } from '@rstest/core';
import * as NS from '../src/reexport/index';
import { doCapture } from '../src/reexportCaller';

// Regression for https://github.com/web-infra-dev/rstest/issues/1492
// `rs.spyOn(NS, 'captureException')` silently no-ops on a re-exported namespace
// export (the `sideEffects` optimization inlines the caller's access straight to
// the origin module, bypassing the namespace object the spy patches). The
// documented alternative — `rs.mock('pkg', { spy: true })` — replaces the module
// factory at build time and intercepts the same calls, including from another
// module. This test locks that behavior in.
rs.mock('../src/reexport/index', { spy: true });

describe('rs.mock spy on re-exported namespace export (#1492)', () => {
  test('exports are wrapped in spies', () => {
    expect(rs.isMockFunction(NS.captureException)).toBe(true);
  });

  test('intercepts a call made from another module', () => {
    doCapture();
    expect(NS.captureException).toHaveBeenCalledWith('boom');
  });

  test('preserves the original implementation and can override it', () => {
    expect(NS.captureException('x')).toBe('REAL:x');

    rs.mocked(NS.captureException).mockReturnValue('MOCK');
    expect(NS.captureException('y')).toBe('MOCK');
  });
});
