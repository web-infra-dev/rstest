import { defineConfig } from '@rstest/core';

const [nodeMajor = 0, nodeMinor = 0, nodePatch = 0] = process.versions.node
  .split('.')
  .map(Number);
const supportsJSDOM30 =
  nodeMajor >= 26 ||
  (nodeMajor === 24 && nodeMinor >= 15) ||
  (nodeMajor === 22 &&
    (nodeMinor > 22 || (nodeMinor === 22 && nodePatch >= 2)));

export default defineConfig({
  isolate: false,
  pool: {
    maxWorkers: 1,
  },
  projects: [
    './jsdom-26/rstest.config.mts',
    './jsdom-29/rstest.config.mts',
    ...(supportsJSDOM30
      ? [
          './jsdom-30/rstest.config.mts',
          './jsdom-30/rstest.prebundle.config.mts',
        ]
      : []),
  ],
});
