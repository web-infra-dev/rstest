import { Rstest } from '../../src/core/rstest';
import { createPool } from '../../src/pool';
import { Pool } from '../../src/pool/pool';
import { createPoolWorker } from '../../src/pool/workers';
import { noopTraceSpan } from '../../src/utils/trace';
import {
  ControlledWorker,
  expectRejection,
  gatedLoadAssets,
  task,
} from './helpers';

rs.mock('../../src/pool/workers', () => ({ createPoolWorker: rs.fn() }));

beforeEach(() => {
  rs.mocked(createPoolWorker)
    .mockClear()
    .mockImplementation(() => new ControlledWorker(true));
});

it('rejects a transport failure during asset loading without sending', async () => {
  const worker = new ControlledWorker(true);
  rs.mocked(createPoolWorker).mockReturnValueOnce(worker);
  const pool = new Pool({
    workerEntry: '',
    maxWorkers: 1,
    minWorkers: 1,
    isolate: false,
  });
  const failure = new Error('transport failed during asset loading');
  const { loadAssets, release } = gatedLoadAssets({
    assetFiles: {},
    sourceMaps: {},
  });
  const rejected = expectRejection(pool.runTest({ ...task(), loadAssets }));
  try {
    await expect
      .poll(() => loadAssets, { interval: 1 })
      .toHaveBeenCalledTimes(1);
    worker.emit('error', failure);
    release();
    const error = await rejected;
    expect(error).toBe(failure);
  } finally {
    release();
    await pool.close();
    await rejected;
  }
});

it('runTests rejects asset loader failures without reporting a worker crash', async () => {
  const context = new Rstest(
    {
      cwd: __dirname,
      command: 'run',
      projects: [],
      initializeReporters: false,
    },
    { pool: { maxWorkers: 1 }, isolate: false },
  );
  const onTestFileResult = rs.fn();
  context.reporters.push({ onTestFileResult });
  const failure = new Error('source map unavailable');
  const getAssetFiles = rs.fn(async () => {
    throw failure;
  });
  const pool = await createPool({ context });
  try {
    await expect(
      pool.runTests({
        entries: [
          {
            testPath: '/first.test.ts',
            distPath: '/first.js',
            chunks: [],
            files: ['/first.js'],
          },
        ],
        assetNames: ['/first.js'],
        getAssetFiles,
        getSourceMaps: async () => ({}),
        setupEntries: [],
        updateSnapshot: 'none',
        project: context.projects[0]!,
        traceSpan: noopTraceSpan,
      }),
    ).rejects.toBe(failure);
    expect(createPoolWorker).toHaveBeenCalledOnce();
    expect(onTestFileResult).not.toHaveBeenCalled();
  } finally {
    await pool.close();
  }
});

it('loads assets only for occupied slots and keeps payloads off queued tasks', async () => {
  const pool = new Pool({
    workerEntry: '',
    maxWorkers: 2,
    minWorkers: 2,
    isolate: false,
  });
  const { loadAssets, release } = gatedLoadAssets({
    assetFiles: { '/entry.js': Buffer.from('entry') },
    sourceMaps: {},
  });
  const tasks = Array.from({ length: 3 }, () => ({ ...task(), loadAssets }));
  const results = tasks.map((item) => pool.runTest(item));
  try {
    await expect
      .poll(() => loadAssets, { interval: 1 })
      .toHaveBeenCalledTimes(2);
    release();
    await Promise.all(results);
    expect(tasks.every((item) => item.options.assets === undefined)).toBe(true);
  } finally {
    release();
    await Promise.allSettled(results);
    await pool.close();
  }
});
