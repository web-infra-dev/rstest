import { join } from 'node:path';
import { withRspackConfig } from '@rstest/adapter-rspack';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: withRspackConfig({
    modifyRspackConfig: (config) => {
      config.resolve ??= {};
      config.resolve.alias = {
        '@modified-void-alias': join(import.meta.dirname, 'fallback.ts'),
      };
    },
  }),
  include: ['./modify-void.fixture.ts'],
});
