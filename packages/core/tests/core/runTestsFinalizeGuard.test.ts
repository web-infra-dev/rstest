import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';

// Drift-guard for the Phase 3 unified finalize. Phase 3 collapsed three browser
// self-finalize copies plus the node finalize into a single `finalizeRunCycle`
// (in `finalizeRun.ts`). A future edit that quietly reintroduces a second
// finalize path — a stray `notifyReportersOnTestRunEnd` or run-time
// `generateCoverage` outside the shared finalizer — would raise these counts and
// trip this test, forcing the new site to be justified (and this guard updated
// deliberately). Salvaged from the phase 0 prior-art branch.

const coreDir = join(__dirname, '../../src/core');

const collectSources = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSources(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
};

const countCalls = (needle: string): Array<{ file: string; count: number }> => {
  // Match invocations only: `name(` with no identifier character right before
  // the name, so imports (`name,`) and const declarations (`name = async (`)
  // do not count. This is a source-text tripwire, not an AST count: a comment
  // or string literal containing `name(` would also match, so keep prose in
  // `src/core` phrased without a literal `fn(` (reference the bare name).
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${needle}\\(`, 'g');
  const hits: Array<{ file: string; count: number }> = [];
  for (const file of collectSources(coreDir)) {
    const source = readFileSync(file, 'utf8');
    const count = source.match(pattern)?.length ?? 0;
    if (count > 0) {
      hits.push({ file: file.slice(coreDir.length + 1), count });
    }
  }
  return hits;
};

const total = (hits: Array<{ count: number }>): number =>
  hits.reduce((sum, hit) => sum + hit.count, 0);

describe('runTests finalize drift-guard', () => {
  it('pins the reporter onTestRunEnd call sites in core', () => {
    const hits = countCalls('notifyReportersOnTestRunEnd');
    // 1. `finalizeRun.ts` — the single unified finalize path.
    // 2. `runTests.ts` — the browser-only `relatedResolutionEmpty` non-watch
    //    empty-run shortcut (no outcomes to reduce; it notifies directly).
    expect(total(hits)).toBe(2);
  });

  it('pins the run-time generateCoverage call sites in core', () => {
    const hits = countCalls('generateCoverage');
    // 1. `finalizeRun.ts` — inside `finalizeRunCycle` (the shared coverage report).
    // 2. `runTests.ts` — the browser-only WATCH bespoke report (watch keeps its
    //    host-driven finalize, so its coverage stays out of the cycle).
    // 3. `mergeReports.ts` — the separate `merge-reports` command, not a run.
    expect(total(hits)).toBe(3);
  });

  it('keeps a single finalizeRunCycle implementation', () => {
    const source = readFileSync(join(coreDir, 'finalizeRun.ts'), 'utf8');
    expect(source.match(/function finalizeRunCycle\b/g)?.length ?? 0).toBe(1);
    // Every caller imports it from `finalizeRun.ts`; it is never redefined
    // elsewhere in core.
    const otherDefs = collectSources(coreDir)
      .filter((file) => !file.endsWith('finalizeRun.ts'))
      .some((file) =>
        /function finalizeRunCycle\b/.test(readFileSync(file, 'utf8')),
      );
    expect(otherDefs).toBe(false);
  });
});
