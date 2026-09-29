import { afterAll, expect, it, rs } from '@rstest/core';
import './registerCjsMock.cjs';

rs.mock('dual-package-mock', () => ({ kind: 'esm mock' }));

afterAll(() => {
  rs.doUnmock('dual-package-mock');
  rs.doUnmockRequire('dual-package-mock');
});

it('keeps ESM and CommonJS mock aliases separate', async () => {
  const esmMock = await rs.importMock<{ kind: string }>('dual-package-mock');
  const cjsMock = rs.requireMock<{ kind: string }>('dual-package-mock');

  expect(esmMock.kind).toBe('esm mock');
  expect(cjsMock.kind).toBe('cjs mock');

  rs.doUnmock('dual-package-mock');
  expect(rs.requireMock<{ kind: string }>('dual-package-mock').kind).toBe(
    'cjs mock',
  );
});
