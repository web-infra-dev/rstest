import { expect, it, rstest } from '@rstest/core';

it('test stubEnv & unstubAllEnvs', () => {
  const env = process.env.NODE_ENV;
  const mockEnv = env === 'production' ? 'development' : 'production';
  rstest.stubEnv('NODE_ENV', mockEnv);

  rstest.stubEnv('TEST_111', '111');

  expect(process.env.NODE_ENV).toBe(mockEnv);

  expect(process.env.TEST_111).toBe('111');

  rstest.stubEnv('NODE_ENV', undefined);
  expect(process.env.NODE_ENV).toBeUndefined();

  rstest.unstubAllEnvs();

  expect(process.env.NODE_ENV).toBe(env);
  expect(process.env.TEST_111).toBeUndefined();
});
