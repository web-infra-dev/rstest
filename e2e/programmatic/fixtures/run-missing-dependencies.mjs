import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const require = createRequire(import.meta.url);
const { version } = require('@rstest/core/package.json');
const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.missing-deps-${process.pid}`);

Object.defineProperty(process.stdin, 'isTTY', {
  configurable: true,
  value: true,
});

await mkdir(root, { recursive: true });
try {
  await writeFile(join(root, 'index.test.js'), "test('works', () => {});\n");
  await mkdir(join(root, '.rstest-reports'));
  await writeFile(
    join(root, '.rstest-reports/blob.json'),
    JSON.stringify({
      version,
      results: [],
      testResults: [],
      duration: { totalTime: 0, buildTime: 0, testTime: 0 },
      snapshotSummary: {
        added: 0,
        didUpdate: false,
        failure: false,
        filesAdded: 0,
        filesRemoved: 0,
        filesRemovedList: [],
        filesUnmatched: 0,
        filesUpdated: 0,
        matched: 0,
        total: 0,
        unchecked: 0,
        uncheckedKeysByFile: [],
        unmatched: 0,
        updated: 0,
      },
      files: {},
    }),
  );

  const config = {
    coverage: { enabled: true },
    globals: true,
    include: ['index.test.js'],
    reporters: [],
  };
  const rstest = await createRstest({ cwd: root, config });
  const runResult = await rstest.run();

  let watchError;
  let watcher;
  try {
    watcher = await rstest.watch();
  } catch (error) {
    watchError = error.message;
  }
  if (watcher) {
    await watcher.close();
  }

  const mergeResult = await rstest.mergeReports();

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      run: {
        status: runResult.status,
        message: runResult.unhandledErrors[0]?.message,
      },
      watch: { message: watchError },
      mergeReports: {
        status: mergeResult.status,
        message: mergeResult.unhandledErrors[0]?.message,
      },
    })}__END__`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
