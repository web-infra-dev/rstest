import { readFileSync, unlinkSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import type {
  CoverageMap,
  CoverageMapData,
  FileCoverageData,
} from 'istanbul-lib-coverage';
import { createFastCoverageMap } from './utils';

/**
 * Off-main-thread coverage ingest worker (issue #1326).
 *
 * Test workers write each file's coverage JSON to disk and ship only the path,
 * so the host never V8-deserializes a per-file coverage object graph on its
 * single event loop. Two ingest shapes are supported:
 *
 * - BATCH (`workerData.files`): the host hands a whole chunk of paths at once
 *   (end-of-run fan-out). Read + JSON.parse + merge them and post one merged
 *   `CoverageMapData`.
 * - STREAMING (`workerData.streaming`): a single long-lived consumer. The host
 *   posts `{ type: 'file', path }` AS EACH per-file coverage is produced during
 *   the run; we merge it incrementally and `unlinkSync` the temp file right
 *   away, then on `{ type: 'done' }` post the single merged map. This keeps the
 *   corpus from accumulating on disk and keeps exactly ONE deduped map resident
 *   (no N-way fan-out, so no N× memory amplification). See #1326 follow-up.
 */

// istanbul's `CoverageMap.toJSON()` returns its internal map of `FileCoverage`
// *instances*. Their methods don't survive `postMessage` structured-clone
// (cloning leaves only a `{ data }` wrapper the host can't merge), so serialize
// each entry down to its raw `FileCoverageData` first — matching how test
// workers ship coverage in `runInPool.ts`.
function serializeMap(coverageMap: CoverageMap): CoverageMapData {
  const merged: CoverageMapData = {};
  for (const [path, value] of Object.entries(coverageMap.toJSON())) {
    merged[path] =
      value && typeof (value as { toJSON?: unknown }).toJSON === 'function'
        ? (value as unknown as { toJSON: () => FileCoverageData }).toJSON()
        : (value as unknown as FileCoverageData);
  }
  return merged;
}

const data = workerData as { files?: string[]; streaming?: boolean };

if (data.streaming) {
  const coverageMap = createFastCoverageMap();
  parentPort!.on(
    'message',
    (msg: { type: 'file'; path: string } | { type: 'done' }) => {
      if (msg.type === 'file') {
        try {
          coverageMap.merge(
            JSON.parse(readFileSync(msg.path, 'utf8')) as CoverageMapData,
          );
        } catch {
          // Skip a corrupt/partial coverage file rather than killing the stream.
        } finally {
          // Consume-then-delete: the corpus never accumulates on disk.
          try {
            unlinkSync(msg.path);
          } catch {
            // already gone / never written
          }
        }
        return;
      }
      // type === 'done': emit the single merged map. The host terminates us.
      parentPort!.postMessage(serializeMap(coverageMap));
    },
  );
} else {
  const { files } = data as { files: string[] };
  const coverageMap = createFastCoverageMap();
  for (const file of files) {
    coverageMap.merge(
      JSON.parse(readFileSync(file, 'utf8')) as CoverageMapData,
    );
  }
  parentPort!.postMessage(serializeMap(coverageMap));
}
