import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from '@rstest/core';

/**
 * Drift guard for the RFC browser-mode isomorphism work (phase 4): the non-watch
 * finalize must stay single-sourced. `runTests.ts` is allowed exactly one
 * reachable `onTestRunEnd` trigger (`notifyReportersOnTestRunEnd`) and one
 * coverage finalize on the unified path; if a bypass finalize path regrows, one
 * of these counts changes and this test fails.
 *
 * Note: `generateCoverage` has a second, watch-only call site in the browser-only
 * WATCH self-finalize block, which is intentionally preserved until the watch
 * unification (phase 5) — hence the expected count of 2. `notifyReportersOnTestRunEnd`
 * stays at 1 because watch browser runs self-finalize inside the `@rstest/browser`
 * host, never through this helper.
 */
describe('runTests finalize drift guard', () => {
  const source = readFileSync(
    join(__dirname, '../../src/core/runTests.ts'),
    'utf-8',
  );

  const countCalls = (name: string): number =>
    source.match(new RegExp(`${name}\\(`, 'g'))?.length ?? 0;

  it('has exactly one onTestRunEnd trigger (single core-driven finalize)', () => {
    expect(countCalls('notifyReportersOnTestRunEnd')).toBe(1);
  });

  it('keeps coverage finalize to the unified path plus the watch-only block', () => {
    // 1 unified (finalizeRun) + 1 watch-only browser self-finalize block.
    expect(countCalls('generateCoverage')).toBe(2);
  });

  it('routes both non-watch finalize callers through the shared helper', () => {
    // Browser-only branch + node/mixed run() both call finalizeRun.
    expect(countCalls('finalizeRun')).toBe(2);
  });

  it('fires reporter.onTestRunEnd from exactly one place', () => {
    // Stronger than the helper-name count: a regrown bypass that loops
    // `reporter.onTestRunEnd?.(...)` inline (like the existing onTestRunStart
    // loops) would not bump `notifyReportersOnTestRunEnd(`, but it bumps this.
    expect(source.match(/\.onTestRunEnd\?\.\(/g)?.length ?? 0).toBe(1);
  });
});
