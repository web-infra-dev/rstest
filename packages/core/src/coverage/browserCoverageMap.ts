import type { TestFileResult } from '../types';
import type { CoverageMap, CoverageProvider } from '../types/coverage';

/**
 * Merge the browser host's per-file `result.coverage` into one map, stripping it
 * from each result to avoid reporter/state cache bloat. Shared by the browser
 * executor's outcome fold and the browser-only watch path (which still
 * self-finalizes host-side until the Phase 6 convergence).
 */
export function buildBrowserCoverageMap(
  results: TestFileResult[],
  coverageProvider: CoverageProvider | null,
): CoverageMap | undefined {
  const map = coverageProvider?.createCoverageMap();
  for (const result of results) {
    if (result.coverage) {
      map?.merge(result.coverage);
      delete result.coverage;
    }
  }
  return map;
}
