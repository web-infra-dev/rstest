import { defineConfig, type RstestConfig } from '@rstest/core';
import rsbuildConfig from './rsbuild.config';

export default defineConfig({
  ...(rsbuildConfig as RstestConfig),
  setupFiles: ['./test/setup.ts'],
  testEnvironment: {
    name: 'jsdom',
    options: {
      url: 'http://localhost:8081/test-options',
      html: `<!doctype html><script>
        window.preInstallTimerFired = false;
        window.preInstallTimer = String(setTimeout(() => {
          window.preInstallTimerFired = true;
        }, 1000));
      </script>`,
    },
  },
});
