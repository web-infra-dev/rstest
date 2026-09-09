import type { Duration, SnapshotSummary } from '../../src/types';

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
