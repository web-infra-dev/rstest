import fs from 'node:fs';
import { dirname, join } from 'node:path';
import fse from 'fs-extra';

/**
 * Install a fixture package into `fixtures/test-pkg/node_modules` once.
 * Several test files in this directory install the same package from
 * parallel workers; an overwriting copy unlinks files another worker is
 * still copying or reading. Copy into a private temp dir, then rename it into
 * place; if another worker got there first, keep its copy.
 */
export const copyFixturePackage = (fixturesDir: string, name: string) => {
  const dest = join(fixturesDir, 'test-pkg/node_modules', name);
  if (fs.existsSync(dest)) {
    return;
  }
  const tmp = `${dest}.${process.pid}.tmp`;
  fse.copySync(join(fixturesDir, name), tmp);
  fs.mkdirSync(dirname(dest), { recursive: true });
  try {
    fs.renameSync(tmp, dest);
  } catch (error) {
    fse.removeSync(tmp);
    if (!fs.existsSync(dest)) {
      throw error;
    }
  }
};
