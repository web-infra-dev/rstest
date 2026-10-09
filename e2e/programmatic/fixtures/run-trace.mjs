import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

// Present as an interactive terminal: the CLI would start the Perfetto helper
// server here and block on Ctrl+C, which an embedded `run()` must never do.
process.stdin.isTTY = true;
delete process.env.CI;

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const root = join(fixtureDir, `.trace-${process.pid}`);
const testFile = join(root, 'sum.test.ts');
const testSource = (value) => `
import { expect, it } from '@rstest/core';

it('sum', () => {
  expect(${value} + 1).toBe(${value + 1});
});
`;

const fileExists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const listTraceFiles = async (dir) =>
  (await fileExists(dir))
    ? (await readdir(dir)).filter((name) => name.startsWith('trace-')).sort()
    : [];
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
const describeTrace = async (trace) => {
  if (!trace) return trace;
  const json = JSON.parse(await readFile(trace.tracePath, 'utf-8'));
  const summary = await readFile(trace.summaryPath, 'utf-8');
  return {
    traceDir: dirname(trace.tracePath),
    summaryDir: dirname(trace.summaryPath),
    traceName: basename(trace.tracePath),
    summaryName: basename(trace.summaryPath),
    traceEvents: json.traceEvents.length,
    summaryLength: summary.trim().length,
  };
};

await mkdir(root, { recursive: true });
await writeFile(testFile, testSource(1));

let watcher;
try {
  const rstest = await createRstest({
    cwd: root,
    config: { include: ['*.test.ts'], reporters: [] },
  });

  const defaultRun = await rstest.run({ trace: true });
  const defaultFilesBefore = await listTraceFiles(join(root, '.rstest'));
  const untracedRun = await rstest.run();
  const defaultFilesAfter = await listTraceFiles(join(root, '.rstest'));

  const watchResults = [];
  let resolveRerun;
  const rerun = new Promise((resolve) => {
    resolveRerun = resolve;
  });
  watcher = await rstest.watch({
    trace: true,
    onResult(result) {
      watchResults.push(result.trace);
      if (watchResults.length === 2) resolveRerun();
    },
  });
  const initialWatchTrace = await describeTrace(watchResults[0]);
  await writeFile(testFile, testSource(2));
  await withTimeout(rerun, 'the watch rerun');
  const rerunWatchTrace = await describeTrace(watchResults[1]);
  await watcher.close();
  watcher = undefined;

  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({
      root,
      statuses: [defaultRun.status, untracedRun.status],
      defaultTrace: await describeTrace(defaultRun.trace),
      untracedHasTraceKey: 'trace' in untracedRun,
      defaultFilesBefore,
      defaultFilesAfter,
      initialWatchTrace,
      rerunWatchTrace,
    })}__END__`,
  );
} finally {
  await watcher?.close();
  await rm(root, { recursive: true, force: true });
}
