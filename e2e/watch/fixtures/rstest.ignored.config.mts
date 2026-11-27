import path from 'node:path';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    bundlerChain(chain) {
      chain.watchOptions({
        ignored: (file: string) => path.basename(file) === 'other.ts',
      });
    },
  },
});
