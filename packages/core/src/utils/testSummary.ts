import type { RawTestResult, TestFileSummary } from '../types';

export const isFlakyResult = (
  result: Pick<RawTestResult, 'status' | 'retryCount'>,
): boolean => result.status === 'passed' && (result.retryCount ?? 0) > 0;

export const getFileSummary = (
  results: readonly Pick<RawTestResult, 'status' | 'retryCount'>[],
): TestFileSummary => {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    flaky: 0,
  };
  for (const result of results) {
    summary[result.status]++;
    if (isFlakyResult(result)) summary.flaky++;
  }
  return summary;
};
