import { buildRunReport } from '../../src/reporter/runReport';
import type {
  Duration,
  SnapshotSummary,
  TestFileResult,
  TestResult,
} from '../../src/types';

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

export const makeRunReport = (input: {
  results: TestFileResult[];
  testResults: TestResult[];
  unhandledErrors?: Error[];
  duration?: Duration;
  passWithNoTests?: boolean;
}) =>
  buildRunReport({
    results: input.results,
    testResults: input.testResults,
    unhandledErrors: input.unhandledErrors,
    snapshotSummary: emptySnapshotSummary,
    duration: input.duration ?? emptyDuration,
    passWithNoTests: input.passWithNoTests ?? false,
  });
