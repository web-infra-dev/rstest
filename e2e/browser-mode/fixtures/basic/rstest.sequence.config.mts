import { defineConfig } from '@rstest/core';
import hooksConfig from '../../../test-api/rstest.sequence.config.mts';
import config from './rstest.config.mts';

export default defineConfig({
  ...config,
  ...hooksConfig,
  include: ['../../../test-api/fixtures/hookOrder.test.ts'],
});
