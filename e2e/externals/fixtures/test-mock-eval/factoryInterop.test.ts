import { expect, it, rs } from '@rstest/core';
import * as actual from 'cjs-shaped' with { rstest: 'importActual' };
import * as mocked from 'cjs-shaped';

// The factory captures the `importActual` namespace of an externalized CJS
// package. Externals load asynchronously (import-type externals), so this
// exercises the lazily-materialized factory: the spread must observe the
// settled namespace, not a pending promise.
rs.mock('cjs-shaped', () => ({ ...actual, added: 'MOCKED' }));

it('should spread a settled importActual namespace inside the factory', () => {
  expect((mocked as any).added).toBe('MOCKED');
  expect((mocked as any).Axios).toBeDefined();
  expect(Object.keys(mocked)).toContain('Axios');
  expect((actual as any).Axios).toBeDefined();
});
