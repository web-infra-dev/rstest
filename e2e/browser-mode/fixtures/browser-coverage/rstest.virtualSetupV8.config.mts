import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-virtual-setup-v8'],
  },
  include: ['tests/sum.test.ts'],
  setupFiles: [
    'data:text/javascript;base64,Z2xvYmFsVGhpcy5fX1JTVEVTVF9WSVJUVUFMX1NFVFVQX18gPSB0cnVlOw==',
  ],
  coverage: {
    enabled: true,
    provider: 'v8',
    reportsDirectory: 'coverage-virtual-setup-v8',
    reporters: ['json'],
  },
});
