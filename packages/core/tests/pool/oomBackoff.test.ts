import { Pool } from '../../src/pool/pool';
import { createPoolWorker } from '../../src/pool/workers';
import {
  ControlledWorker,
  expectRejection,
  gatedLoadAssets,
  task,
  tick,
} from './helpers';

rs.mock('../../src/pool/workers', () => ({ createPoolWorker: rs.fn() }));

let workers: ControlledWorker[];
let pool: Pool;
const active = () => workers.filter((worker) => worker.live && worker.request);
const waitActive = async (count: number) => {
  await expect.poll(() => active().length, { interval: 1 }).toBe(count);
};

beforeEach(() => {
  rs.stubGlobal(
    'process',
    Object.create(process, { platform: { value: 'linux' } }),
  );
  workers = [];
  rs.mocked(createPoolWorker).mockImplementation(() => {
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  });
  pool = new Pool({
    workerEntry: '',
    maxWorkers: 4,
    minWorkers: 4,
    isolate: false,
  });
});

afterEach(async () => {
  await pool.close();
  rs.unstubAllGlobals();
});

it('halves once per spawn epoch and recovers after ceiling completions', async () => {
  const retry = rs.fn();
  const results = Array.from({ length: 9 }, () =>
    pool.runTest({ ...task(), onRetry: retry }),
  );
  await waitActive(4);
  active()[0]!.kill();
  active()[0]!.kill();
  await expect.poll(() => retry, { interval: 1 }).toHaveBeenCalledTimes(2);
  expect(retry.mock.calls.map((call) => call[1])).toEqual([2, 2]);
  active()[0]!.finish('fail');
  await waitActive(2);
  active()[0]!.finish();
  await waitActive(3);
  for (let i = 0; i < 3; i++) {
    active()[0]!.finish();
    await waitActive(i === 2 ? 4 : 3);
  }
  for (const worker of active()) worker.finish();
  await Promise.all(results);
});

it('retries at the queue head, runs attempt three exclusively, then fails', async () => {
  const killed = { ...task(), onRetry: rs.fn() };
  killed.options.color = true;
  const result = expectRejection(pool.runTest(killed));
  const other = Array.from({ length: 5 }, () => pool.runTest(task()));
  await waitActive(4);
  active()[0]!.kill();
  await expect
    .poll(() => killed.onRetry, { interval: 1 })
    .toHaveBeenCalledTimes(1);
  active()[0]!.finish();
  await tick();
  active()[0]!.finish();
  // Queued files must not take the retry's place.
  await expect
    .poll(() => active().some((worker) => worker.request?.options.color), {
      interval: 1,
    })
    .toBe(true);
  await waitActive(3);
  active()
    .find((worker) => worker.request?.options.color)!
    .kill();
  await expect
    .poll(() => killed.onRetry, { interval: 1 })
    .toHaveBeenCalledTimes(2);
  const remaining = active();
  expect(remaining).toHaveLength(2);
  remaining[0]!.finish();
  await tick();
  expect(active()).toEqual([remaining[1]]);
  const spawned = workers.length;
  remaining[1]!.finish();
  await waitActive(1);
  const alone = active()[0]!;
  expect(alone.request?.options.color).toBe(true);
  // Idle workers keep their heaps, so the last attempt starts only after they
  // exit, on a fresh worker.
  expect(workers.filter((worker) => worker.live)).toEqual([alone]);
  expect(workers.indexOf(alone)).toBe(spawned);
  alone.kill();
  expect((await result).message).toContain(
    'SIGKILL even when running alone after 3 attempts',
  );
  await waitActive(1);
  active()[0]!.finish();
  await Promise.all(other);
});

it('retries a SIGKILL during asset loading with the decreased ceiling', async () => {
  const retry = rs.fn();
  const { loadAssets, release } = gatedLoadAssets({
    assetFiles: {},
    sourceMaps: {},
  });
  const result = pool.runTest({ ...task(), loadAssets, onRetry: retry });
  const others = Array.from({ length: 3 }, () => pool.runTest(task()));
  await expect.poll(() => loadAssets, { interval: 1 }).toHaveBeenCalledTimes(1);
  await waitActive(3);
  workers[0]!.kill();
  release();
  await expect.poll(() => retry, { interval: 1 }).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledWith(1, 2);
  active()[0]!.finish();
  active()[0]!.finish();
  await expect.poll(() => loadAssets, { interval: 1 }).toHaveBeenCalledTimes(2);
  await waitActive(2);
  for (const worker of active()) worker.finish();
  await Promise.all([result, ...others]);
});
