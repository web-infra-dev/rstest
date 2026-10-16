import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fse from 'fs-extra';

const externalsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../externals',
);

/**
 * Several `externals` launcher files run fixtures that resolve these packages
 * from `node_modules`. Install them once here, before any worker starts, so
 * parallel launcher files never copy over a package another one is reading.
 */
export function setup() {
  const fixtures = join(externalsDir, 'fixtures');
  const testPkgModules = join(fixtures, 'test-pkg/node_modules');
  const externalsModules = join(externalsDir, 'node_modules');

  for (const name of [
    'test-bundle',
    'test-module-field',
    'test-lodash',
    'test-interop',
  ]) {
    fse.copySync(join(fixtures, name), join(testPkgModules, name));
  }
  for (const name of ['test-interop', 'test-vm-external']) {
    fse.copySync(join(fixtures, name), join(externalsModules, name));
  }
  fse.copySync(
    join(fixtures, 'test-vm-external/helper.cjs'),
    join(externalsModules, 'test-vm-external/node_modules/legacy/index.js'),
  );
}
