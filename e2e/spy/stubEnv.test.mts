import { expect, it, rstest } from '@rstest/core';

it('test stubEnv & unstubAllEnvs in import.meta.env', () => {
  const env = import.meta.env.NODE_ENV;
  const mockEnv = env === 'production' ? 'development' : 'production';
  rstest.stubEnv('NODE_ENV', mockEnv);

  rstest.stubEnv('TEST_111', '111');

  expect(import.meta.env.NODE_ENV).toBe(mockEnv);

  expect(import.meta.env.TEST_111).toBe('111');

  rstest.stubEnv('NODE_ENV', undefined);
  expect(import.meta.env.NODE_ENV).toBeUndefined();

  rstest.unstubAllEnvs();

  expect(import.meta.env.NODE_ENV).toBe(env);
  expect(import.meta.env.TEST_111).toBeUndefined();
});
