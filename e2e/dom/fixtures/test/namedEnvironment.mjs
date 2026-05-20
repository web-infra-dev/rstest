import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinEnvironments } from '@rstest/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const teardownFile = path.join(__dirname, 'named-environment.teardown.txt');

export const environment = {
  name: 'named-jsdom',
  async setup(global, options) {
    const base = await builtinEnvironments.jsdom.setup(global, {
      url: options.url,
    });

    global.__NAMED_ENV_MARKER__ = options.marker;

    return {
      async teardown() {
        delete global.__NAMED_ENV_MARKER__;
        fs.writeFileSync(teardownFile, String(options.marker));
        await base.teardown();
      },
    };
  },
};