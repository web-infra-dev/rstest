import { defineConfig, type RstestConfig } from '@rstest/core';
import rsbuildConfig from './rsbuild.config';

export default defineConfig({
  ...(rsbuildConfig as RstestConfig),
  testEnvironment: {
    name: './test/namedEnvironment.mjs',
    options: {
      marker: 'named-marker',
      url: 'https://named-env.example/',
    },
  },
});