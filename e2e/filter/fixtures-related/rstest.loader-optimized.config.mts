import { mergeRstestConfig } from '@rstest/core';
import config from './rstest.loader.config.mts';

export default mergeRstestConfig(config, {
  tools: {
    rspack: {
      optimization: { concatenateModules: true, usedExports: true },
    },
  },
});
