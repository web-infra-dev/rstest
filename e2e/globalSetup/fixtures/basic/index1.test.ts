import { beforeAll, expect, it } from '@rstest/core';

beforeAll(() => {
  console.log('[rstest] Running basic tests');
});

it('should access process.env', () => {
  expect(process.env.GLOBAL_SETUP_EXECUTED).toBe('true');
});
