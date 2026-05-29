import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import type { CoverageMapData, FileCoverageData } from 'istanbul-lib-coverage';
import { createFastCoverageMap } from './utils';

/**
 * Off-main-thread coverage ingest worker (issue #1326).
 *
 * Test workers write each file's coverage JSON to disk and ship only the path,
 * so the host never V8-deserializes a per-file coverage object graph on its
 * single event loop during the run. The host then hands a chunk of those paths
 * to this worker via `workerData.files`. Here we read + JSON.parse + merge them
 * with istanbul's real merge ({@link createFastCoverageMap}) and post back a
 * single merged `CoverageMapData`.
 *
 * Running the expensive `JSON.parse` here keeps it off the host event loop, and
 * returning one merged map (deduplicated to roughly the unique-module set,
 * regardless of how many files were in the chunk) keeps the host-side
 * structured-clone receive cheap.
 */
const { files } = workerData as { files: string[] };
const coverageMap = createFastCoverageMap();
for (const file of files) {
  coverageMap.merge(JSON.parse(readFileSync(file, 'utf8')) as CoverageMapData);
}
// istanbul's `CoverageMap.toJSON()` returns its internal map of `FileCoverage`
// *instances*. Their methods don't survive `postMessage` structured-clone
// (cloning leaves only a `{ data }` wrapper the host can't merge), so serialize
// each entry down to its raw `FileCoverageData` first — matching how test
// workers ship coverage in `runInPool.ts`.
const merged: CoverageMapData = {};
for (const [path, value] of Object.entries(coverageMap.toJSON())) {
  merged[path] =
    value && typeof (value as { toJSON?: unknown }).toJSON === 'function'
      ? (value as unknown as { toJSON: () => FileCoverageData }).toJSON()
      : (value as unknown as FileCoverageData);
}
parentPort!.postMessage(merged);
