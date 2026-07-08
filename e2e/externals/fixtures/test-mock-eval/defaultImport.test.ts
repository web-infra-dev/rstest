import { expect, it, rs } from '@rstest/core';
import * as actual from 'cjs-shaped' with { rstest: 'importActual' };
import mockedDefault, { added } from 'cjs-shaped';

// A default import compiles to `__webpack_require__.n(exports)`, which reads
// `__esModule` among the importer's harmony requires — BEFORE the async-deps
// await. That read must not force the factory early (the captured `actual`
// namespace is still unsettled there).
rs.mock('cjs-shaped', () => ({ ...actual, added: 'MOCKED' }));

it('should keep a default-imported lazy mock unmaterialized until use', () => {
  expect((mockedDefault as any).Axios).toBeDefined();
  expect(added).toBe('MOCKED');
});
