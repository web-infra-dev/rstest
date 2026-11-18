import { expect, it } from '@rstest/core';
import { config } from './throwOnImport';

it('reads the config', () => {
  expect(config.port).toBe(3000);
});
