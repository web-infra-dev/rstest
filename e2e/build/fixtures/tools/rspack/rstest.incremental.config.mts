import type { Rspack } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';
import baseConfig from './rstest.config.mts';

const reportIncremental = {
  apply(compiler: Rspack.Compiler) {
    compiler.hooks.beforeCompile.tap('report-incremental', () => {
      const { name, incremental } = compiler.options;
      console.log(
        `incremental ${name}: ${Boolean(incremental && incremental.buildModuleGraph)}`,
      );
    });
  },
};

export default defineConfig({
  projects: [
    {
      extends: baseConfig,
      name: 'default',
      tools: { rspack: { plugins: [reportIncremental] } },
    },
    {
      extends: baseConfig,
      name: 'explicit',
      tools: {
        rspack: (config) => {
          config.plugins.push(reportIncremental);
          config.incremental = 'safe';
        },
      },
    },
  ],
});
