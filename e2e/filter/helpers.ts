import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished } from '@rstest/core';
import { prepareFixtures } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const coverageFixturePath = join(__dirname, '../test-coverage/fixtures');

/**
 * Copy a fixture directory into a temporary directory that is removed after
 * the test, and link the dependency tree the e2e fixtures resolve from.
 */
export const prepareTempFixture = async ({
  fixturesPath,
  prefix,
}: {
  fixturesPath: string;
  prefix: string;
}) => {
  const fixturesTargetPath = await mkdtemp(join(tmpdir(), `rstest-${prefix}-`));

  onTestFinished(() =>
    rm(fixturesTargetPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    }),
  );

  const fixtureFs = await prepareFixtures({
    fixturesPath,
    fixturesTargetPath,
  });

  await symlink(
    join(coverageFixturePath, 'node_modules'),
    join(fixturesTargetPath, 'node_modules'),
    'dir',
  );

  return { fixturesTargetPath, ...fixtureFs };
};
