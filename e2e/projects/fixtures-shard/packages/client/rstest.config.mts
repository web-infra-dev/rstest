import { defineProject, type RstestConfig } from '@rstest/core';
import rsbuildConfig from './rsbuild.config';

export default defineProject({
  projects: [
    {
      root: __dirname,
      ...(rsbuildConfig as RstestConfig),
      name: 'client-jsdom',
      testEnvironment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      exclude: ['test/node.test.ts'],
    },
    {
      root: __dirname,
      name: 'client-node',
      include: ['test/node.test.ts'],
    },
  ],
});
