import { describe, expect, it } from '@rstest/core';
import {
  collectWatchTestFiles,
  commitWatchFileSetUpdate,
  planWatchRerun,
} from '../src/watchRerunPlanner';

describe('watch rerun planner', () => {
  it('should detect test file set changes from project entries', () => {
    const plan = planWatchRerun({
      projectEntries: [
        {
          project: { name: 'project-a' },
          testFiles: ['/a.test.ts', '/b.test.ts'],
        },
      ],
      previousTestFiles: [{ testPath: '/a.test.ts', projectName: 'project-a' }],
      affectedTestFiles: [],
    });

    expect(plan).toEqual({
      fileSetUpdate: {
        currentTestFiles: [
          { testPath: '/a.test.ts', projectName: 'project-a' },
          { testPath: '/b.test.ts', projectName: 'project-a' },
        ],
        deletedTestPaths: [],
      },
      decision: {
        kind: 'rerun',
        testPaths: ['/a.test.ts', '/b.test.ts'],
        message: 'Test file set changed, re-running 2 file(s)...\n',
      },
    });
  });

  it('should preserve all project entries for affected test paths', () => {
    const projectEntries = [
      {
        project: { name: 'project-a' },
        testFiles: ['tests/b.test.ts', 'tests/a.test.ts'],
      },
      {
        project: { name: 'project-b' },
        testFiles: ['tests/a.test.ts'],
      },
    ];

    const plan = planWatchRerun({
      projectEntries,
      previousTestFiles: collectWatchTestFiles(projectEntries),
      affectedTestFiles: [
        'tests/a.test.ts',
        'tests/a.test.ts',
        'tests/missing.test.ts',
      ],
    });

    expect(plan).toEqual({
      decision: {
        kind: 'rerun',
        testPaths: ['tests/a.test.ts'],
        message: 'Re-running 2 affected test file(s)...\n',
      },
    });
  });

  it('should remain idle when no changes are present', () => {
    const projectEntries = [
      {
        project: { name: 'project-a' },
        testFiles: ['/a.test.ts'],
      },
    ];

    const plan = planWatchRerun({
      projectEntries,
      previousTestFiles: collectWatchTestFiles(projectEntries),
      affectedTestFiles: [],
    });

    expect(plan).toEqual({
      decision: {
        kind: 'idle',
        message: 'No affected browser test files detected, skipping re-run.\n',
      },
    });
  });

  it('should commit an empty file-set decision and prune deleted files', () => {
    const previousTestFiles = [
      { testPath: '/a.test.ts', projectName: 'project-a' },
    ];
    const plan = planWatchRerun({
      projectEntries: [{ project: { name: 'project-a' }, testFiles: [] }],
      previousTestFiles,
      affectedTestFiles: [],
    });

    expect(plan).toEqual({
      fileSetUpdate: {
        currentTestFiles: [],
        deletedTestPaths: ['/a.test.ts'],
      },
      decision: {
        kind: 'empty',
        message: 'No browser test files remain after update.\n',
      },
    });

    const watchState = { lastTestFiles: previousTestFiles };
    const pruned: string[][] = [];
    commitWatchFileSetUpdate(plan.fileSetUpdate, watchState, (testPaths) => {
      pruned.push(testPaths);
    });

    expect(watchState.lastTestFiles).toEqual([]);
    expect(pruned).toEqual([['/a.test.ts']]);
  });
});
