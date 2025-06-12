import { type RstestConfig, defineConfig } from '@rstest/core';
import rsbuildConfig from './rsbuild.config';

export default defineConfig({
  ...(rsbuildConfig as RstestConfig),
  testEnvironment: 'jsdom',
});
