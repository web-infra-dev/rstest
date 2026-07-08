import { expect, it, rs } from '@rstest/core';
import { useFlag } from 'consumer-pkg';

// `consumer-pkg` is an UNMOCKED externalized package whose internal
// `import { readFlag } from 'env-singleton'` must resolve to the mock.
rs.mock('env-singleton', () => ({ readFlag: () => 'MOCKED' }));

it('should apply the mock inside an externalized package that imports it', () => {
  expect(useFlag()).toBe('MOCKED');
});
