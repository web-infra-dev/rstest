import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const teardownFile = join(
  __dirname,
  '..',
  'test',
  'package-environment.teardown.txt',
);

/** @type {import('@rstest/core').TestEnvironment<typeof globalThis, { marker: string }>} */
const environment = {
  name: 'package-marker',
  async setup(global, options) {
    global.__PACKAGE_ENV_MARKER__ = options.marker;

    return {
      async teardown() {
        delete global.__PACKAGE_ENV_MARKER__;
        await writeFile(teardownFile, options.marker, 'utf8');
      },
    };
  },
};

export default environment;
