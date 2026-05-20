import { defineConfig, type RstestConfig } from '@rstest/core';
import rsbuildConfig from './rsbuild.config';

export default defineConfig({
  ...(rsbuildConfig as RstestConfig),
  setupFiles: ['./test/setup.ts'],
  testEnvironment: {
    name: './test/customEnvironment.mjs',
    options: {
      marker: 'custom-marker',
      jsdom: {
        url: 'https://custom-env.example/',
      },
    },
  },
});
