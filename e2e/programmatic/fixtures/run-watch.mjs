import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.watch-${process.pid}`);
const teardownLog = join(root, 'teardown.log');
const firstTest = join(root, 'first.test.ts');
const secondTest = join(root, 'second.test.ts');
const emptyFilterRoot = join(root, 'empty-filter');
const zeroMatchRoot = join(root, 'zero-match');
const snapshotRoot = join(root, 'snapshot-options');
const testSource = (name, value) => `
import { expect, it } from '@rstest/core';

it(${JSON.stringify(name)}, () => {
  expect(${value}).toBe(${value});
});
`;
const fileExists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

await mkdir(root, { recursive: true });
await writeFile(firstTest, testSource('first', 1));
await writeFile(secondTest, testSource('second', 2));
await writeFile(
  join(root, 'globalSetup.ts'),
  `
import { appendFile } from 'node:fs/promises';

export default function globalSetup() {
  return () => appendFile(${JSON.stringify(teardownLog)}, 'teardown\\n');
}
`,
);

const cycles = [];
let resolveFirst;
let resolveSecond;
const firstCycle = new Promise((resolve) => {
  resolveFirst = resolve;
});
const secondCycle = new Promise((resolve) => {
  resolveSecond = resolve;
});
const withTimeout = async (promise, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}`)),
      20_000,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const openWatchers = new Set();
try {
  await mkdir(emptyFilterRoot, { recursive: true });
  await writeFile(
    join(emptyFilterRoot, 'present.test.ts'),
    testSource('present', 3),
  );
  const emptyFilterRstest = await createRstest({
    cwd: emptyFilterRoot,
    config: { include: ['*.test.ts'], reporters: [] },
  });
  const emptyFilterCycles = {};
  for (const filterMode of ['fuzzy', 'exact']) {
    let firstResult;
    const emptyFilterWatcher = await emptyFilterRstest.watch({
      filters: [],
      filterMode,
      onResult(result) {
        firstResult ??= result;
      },
    });
    openWatchers.add(emptyFilterWatcher);
    emptyFilterCycles[filterMode] = firstResult.files.map((file) =>
      file.testPath.split('/').pop(),
    );
    await emptyFilterWatcher.close();
    openWatchers.delete(emptyFilterWatcher);
  }

  await mkdir(zeroMatchRoot, { recursive: true });
  const zeroMatchCycles = [];
  let resolveAddedTest;
  const addedTestCycle = new Promise((resolve) => {
    resolveAddedTest = resolve;
  });
  const zeroMatchRstest = await createRstest({
    cwd: zeroMatchRoot,
    config: { include: ['*.test.ts'], reporters: [] },
  });
  const zeroMatchWatcher = await zeroMatchRstest.watch({
    filters: ['added.test.ts'],
    filterMode: 'exact',
    onResult(result) {
      const files = result.files.map((file) => file.testPath.split('/').pop());
      zeroMatchCycles.push(files);
      if (files.includes('added.test.ts')) {
        resolveAddedTest();
      }
    },
  });
  openWatchers.add(zeroMatchWatcher);
  await writeFile(
    join(zeroMatchRoot, 'added.test.ts'),
    testSource('added after watch startup', 4),
  );
  await withTimeout(addedTestCycle, 'the newly added matching test cycle');
  await zeroMatchWatcher.close();
  openWatchers.delete(zeroMatchWatcher);

  await mkdir(snapshotRoot, { recursive: true });
  await writeFile(
    join(snapshotRoot, 'snapshot.test.ts'),
    `
import { expect, it } from '@rstest/core';

it('does not create a snapshot', () => {
  expect('value').toMatchSnapshot();
});
`,
  );
  const snapshotFile = join(
    snapshotRoot,
    '__snapshots__',
    'snapshot.test.ts.snap',
  );
  const snapshotRstest = await createRstest({
    cwd: snapshotRoot,
    config: { include: ['*.test.ts'], reporters: [], update: true },
  });
  const updateFalseRun = await snapshotRstest.run({
    changed: false,
    update: false,
  });
  const snapshotAfterRun = await fileExists(snapshotFile);
  const updateUndefinedRun = await snapshotRstest.run();
  const snapshotAfterUndefinedRun = await fileExists(snapshotFile);
  await rm(join(snapshotRoot, '__snapshots__'), {
    recursive: true,
    force: true,
  });
  let updateFalseWatchResult;
  const snapshotWatcher = await snapshotRstest.watch({
    changed: false,
    update: false,
    onResult(result) {
      updateFalseWatchResult = result;
    },
  });
  openWatchers.add(snapshotWatcher);
  await snapshotWatcher.close();
  openWatchers.delete(snapshotWatcher);
  const snapshotAfterWatch = await fileExists(snapshotFile);
  let updateUndefinedWatchResult;
  const defaultSnapshotWatcher = await snapshotRstest.watch({
    onResult(result) {
      updateUndefinedWatchResult = result;
    },
  });
  openWatchers.add(defaultSnapshotWatcher);
  await defaultSnapshotWatcher.close();
  openWatchers.delete(defaultSnapshotWatcher);
  const snapshotAfterUndefinedWatch = await fileExists(snapshotFile);

  const teardownRoot = join(
    fixtureDir,
    '../../globalSetup/fixtures/teardown-error',
  );
  const teardownRstest = await createRstest({
    cwd: teardownRoot,
    config: {
      globalSetup: './globalSetup.ts',
      include: ['index.test.ts'],
      reporters: [],
    },
  });
  let teardownRunResult;
  const teardownWatcher = await teardownRstest.watch({
    onResult(result) {
      teardownRunResult = result;
    },
  });
  openWatchers.add(teardownWatcher);
  const teardownCloseErrors = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await teardownWatcher.close();
    } catch (error) {
      teardownCloseErrors.push(error.message);
    }
  }
  openWatchers.delete(teardownWatcher);

  let configCalls = 0;
  const rstest = await createRstest({
    cwd: root,
    config: () => {
      configCalls += 1;
      return {
        include: ['*.test.ts'],
        globalSetup: ['./globalSetup.ts'],
        reporters: [],
      };
    },
  });
  const selectorRejections = {};
  for (const [selector, options] of [
    ['related', { related: true }],
    ['changed', { changed: true }],
  ]) {
    try {
      await rstest.watch(options);
    } catch (error) {
      selectorRejections[selector] = error.message;
    }
  }
  const configCallsAfterRejections = configCalls;

  const watcher = await rstest.watch({
    changed: false,
    async onResult(result) {
      cycles.push({
        ok: result.ok,
        files: result.files.map((file) => file.testPath.split('/').pop()),
        tests: result.stats.tests.total,
      });
      if (cycles.length === 1) {
        resolveFirst();
        await Promise.resolve();
        throw new Error('host callback failure must be isolated');
      }
      if (cycles.length === 2) {
        resolveSecond();
      }
    },
  });
  openWatchers.add(watcher);

  await withTimeout(firstCycle, 'the initial watch cycle');
  await writeFile(firstTest, testSource('first updated', 3));
  await withTimeout(secondCycle, 'the watch rerun');
  await watcher.close();
  openWatchers.delete(watcher);

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      cycles,
      emptyFilterCycles,
      zeroMatchCycles,
      updateOptions: {
        run: {
          falseOk: updateFalseRun.ok,
          falseCreatedSnapshot: snapshotAfterRun,
          undefinedOk: updateUndefinedRun.ok,
          undefinedCreatedSnapshot: snapshotAfterUndefinedRun,
        },
        watch: {
          falseOk: updateFalseWatchResult?.ok,
          falseCreatedSnapshot: snapshotAfterWatch,
          undefinedOk: updateUndefinedWatchResult?.ok,
          undefinedCreatedSnapshot: snapshotAfterUndefinedWatch,
        },
      },
      teardownFailure: {
        runOk: teardownRunResult?.ok,
        closeErrors: teardownCloseErrors,
      },
      selectorRejections,
      configCallsAfterRejections,
      teardown: (await readFile(teardownLog, 'utf8')).trim().split('\n'),
    })}__END__`,
  );
} finally {
  await Promise.allSettled(
    Array.from(openWatchers, (watcher) => watcher.close()),
  );
  await rm(root, { recursive: true, force: true });
}
