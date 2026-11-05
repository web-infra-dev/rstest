import { defineConfig } from '@rstest/core';
import baseConfig from './rstest.config.mts';

export default defineConfig({
  ...baseConfig,
  repeats: 2,
  include: ['../../../test-api/fixtures/testOptionsRepeatsPass.test.ts'],
});
