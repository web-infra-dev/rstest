import { defineConfig } from '@rstest/core';
import rsbuildConfig from './rsbuild.config';

export default defineConfig({
  ...rsbuildConfig,
  testEnvironment: 'jsdom',
});
