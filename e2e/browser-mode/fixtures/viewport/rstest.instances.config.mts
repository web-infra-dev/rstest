import { defineConfig } from '@rstest/core';
import base from './rstest.config.mts';
import { ciChromeEntry } from '../ports';

export default defineConfig({
  ...base,
  browser: {
    ...base.browser,
    provider: 'playwright',
    viewport: { width: 1000, height: 700 },
    instances: [
      {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        ...ciChromeEntry(),
      },
      { browserName: 'firefox', viewport: { width: 390, height: 844 } },
      { browserName: 'webkit', viewport: { width: 390, height: 844 } },
    ],
  },
});
