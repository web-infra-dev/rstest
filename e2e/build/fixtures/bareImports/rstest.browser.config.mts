import { defineConfig } from '@rstest/core';
import {
  BROWSER_PORTS,
  BROWSER_TEST_TIMEOUT,
} from '../../../browser-mode/fixtures/ports';
import config from './rstest.config.mts';

export default defineConfig({
  ...config,
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['bare-imports'],
  },
  testTimeout: BROWSER_TEST_TIMEOUT,
});
