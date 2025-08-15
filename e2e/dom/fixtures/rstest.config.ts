import { defineConfig, type RstestConfig } from '@rstest/core';
import rsbuildConfig from './rsbuild.config';

export default defineConfig({
  ...(rsbuildConfig as RstestConfig),
  setupFiles: ['./test/setup.ts'],
});
