import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinEnvironments } from '@rstest/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const teardownFile = path.join(__dirname, 'custom-environment.teardown.txt');

export default {
  name: 'custom-jsdom',
  async setup(global, options) {
    const jsdomEnvironment = await builtinEnvironments.jsdom.setup(
      global,
      options.jsdom ?? {},
    );

    global.__CUSTOM_ENV_MARKER__ = options.marker;

    return {
      async teardown() {
        delete global.__CUSTOM_ENV_MARKER__;
        fs.writeFileSync(teardownFile, String(options.marker));
        await jsdomEnvironment.teardown();
      },
    };
  },
};