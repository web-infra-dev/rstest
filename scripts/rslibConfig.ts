import type { Rspack } from '@rstest/core';

export const rslibRspackConfig = {
  experiments: {
    runtimeMode: 'rspack',
  },
  module: {
    parser: {
      javascript: {
        // Avoid embedding build-time dependency file URLs in published output.
        // https://github.com/web-infra-dev/rslib/pull/1814
        createRequire: false,
      },
    },
  },
} satisfies Rspack.Configuration;
