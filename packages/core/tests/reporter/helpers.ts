import type {
  Duration,
  SnapshotSummary,
  TestFileSummary,
  TestRunEndPayload,
  TestRunSummary,
} from '../../src/types';

export const emptyFileSummary: TestFileSummary = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  todo: 0,
  flaky: 0,
};

export const emptyRunSummary: TestRunSummary = {
  tests: emptyFileSummary,
  files: { total: 0, failed: 0 },
};

export const emptySnapshotSummary: SnapshotSummary = {
  added: 0,
  didUpdate: false,
  failure: false,
  filesAdded: 0,
  filesRemoved: 0,
  filesRemovedList: [],
  filesUnmatched: 0,
  filesUpdated: 0,
  matched: 0,
  total: 0,
  unchecked: 0,
  uncheckedKeysByFile: [],
  unmatched: 0,
  updated: 0,
};

export const emptyDuration: Duration = {
  totalTime: 0,
  buildTime: 0,
  testTime: 0,
};

export const emptyRunEndPayload: TestRunEndPayload = {
  status: 'passed',
  results: [],
  testResults: [],
  summary: emptyRunSummary,
  duration: emptyDuration,
  snapshotSummary: emptySnapshotSummary,
  unhandledErrors: [],
  getSourcemap: async () => null,
};
