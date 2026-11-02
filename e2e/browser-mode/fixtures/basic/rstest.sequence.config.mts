import { defineConfig } from '@rstest/core';
import hooksConfig from '../../../test-api/rstest.sequence.config.mts';
import config from './rstest.config.mts';

export default defineConfig({
  ...config,
  ...hooksConfig,
  include: hooksConfig.include?.map((path) => `../../../test-api/${path}`),
});
