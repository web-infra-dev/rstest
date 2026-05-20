import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinEnvironments } from '@rstest/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const teardownFile = path.join(__dirname, 'custom-node-environment.teardown.txt');

export default {
  name: 'custom-node',
  async setup(global, options) {
    const nodeEnvironment = await builtinEnvironments.node.setup(global, options);

    global.__CUSTOM_NODE_ENV_MARKER__ = options.marker;

    return {
      async teardown() {
        delete global.__CUSTOM_NODE_ENV_MARKER__;
        fs.writeFileSync(teardownFile, String(options.marker));
        await nodeEnvironment.teardown();
      },
    };
  },
};