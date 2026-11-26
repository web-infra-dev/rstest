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
        deletedTestFiles: [],
        deletedTestPaths: [],
      },
      decision: {
        kind: 'rerun',
        testPaths: ['/a.test.ts', '/b.test.ts'],
        message: 'Test file set changed, re-running 2 file(s)...\n',
      },
    });
  });

  it('keeps update shortcuts scoped when the test file set changes', () => {
    const plan = planWatchRerun({
      projectEntries: [
        {
          project: { name: 'project-a' },
          testFiles: ['/a.test.ts', '/b.test.ts', '/new.test.ts'],
        },
      ],
      previousTestFiles: [
        { testPath: '/a.test.ts', projectName: 'project-a' },
        { testPath: '/b.test.ts', projectName: 'project-a' },
      ],
      affectedTestFiles: [],
      requestedTestPaths: ['/a.test.ts'],
    });

    expect(plan.decision).toEqual({
      kind: 'rerun',
      testPaths: ['/a.test.ts'],
      message: 'Test file set changed, re-running 1 file(s)...\n',
    });
    expect(plan.deferredTestPaths).toEqual(['/new.test.ts']);
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

  it('should match Windows paths without regard to drive or segment case', () => {
    const testPath = 'D:/a/rstest/tests/snap.test.ts';
    const plan = planWatchRerun({
      projectEntries: [
        { project: { name: 'project-a' }, testFiles: [testPath] },
      ],
      previousTestFiles: [
        {
          testPath: 'd:\\A\\RSTEST\\tests\\snap.test.ts',
          projectName: 'project-a',
        },
      ],
      affectedTestFiles: ['d:\\a\\rstest\\tests\\snap.test.ts'],
    });

    expect(plan).toEqual({
      decision: {
        kind: 'rerun',
        testPaths: [testPath],
        message: 'Re-running 1 affected test file(s)...\n',
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
        deletedTestFiles: [
          { testPath: '/a.test.ts', projectName: 'project-a' },
        ],
        deletedTestPaths: ['/a.test.ts'],
      },
      decision: {
        kind: 'empty',
        message: 'No browser test files remain after update.\n',
      },
    });

    const watchState = {
      lastTestFiles: previousTestFiles,
      pendingDeletedTestFiles: [] as typeof previousTestFiles,
    };
    commitWatchFileSetUpdate(plan.fileSetUpdate, watchState);

    expect(watchState.lastTestFiles).toEqual([]);
    expect(watchState.pendingDeletedTestFiles).toEqual(previousTestFiles);
  });

  it('keeps deleted files project-scoped and prunes only paths gone from every project', () => {
    const sameTestPath = '/a.test.ts';
    const removedTestPath = '/removed.test.ts';
    const plan = planWatchRerun({
      projectEntries: [
        { project: { name: 'project-b' }, testFiles: [sameTestPath] },
      ],
      previousTestFiles: [
        { testPath: sameTestPath, projectName: 'project-a' },
        { testPath: sameTestPath, projectName: 'project-b' },
        { testPath: removedTestPath, projectName: 'project-a' },
      ],
      affectedTestFiles: [],
    });

    expect(plan.fileSetUpdate).toEqual({
      currentTestFiles: [{ testPath: sameTestPath, projectName: 'project-b' }],
      deletedTestFiles: [
        { testPath: sameTestPath, projectName: 'project-a' },
        { testPath: removedTestPath, projectName: 'project-a' },
      ],
      deletedTestPaths: [removedTestPath],
    });
  });

  it('scopes rebuilds and rerun-all requests by active filterTestPaths', () => {
    const projectEntries = [
      {
        project: { name: 'project-a' },
        testFiles: ['/basic.test.ts', '/snap.test.ts'],
      },
    ];
    const previousTestFiles = collectWatchTestFiles(projectEntries);
    const onlyBasic = (paths: string[]) =>
      paths.filter((filePath) => filePath.includes('basic'));

    // Non-matching edit stays idle.
    expect(
      planWatchRerun({
        projectEntries,
        previousTestFiles,
        affectedTestFiles: ['/snap.test.ts'],
        filterTestPaths: onlyBasic,
      }).decision.kind,
    ).toBe('idle');

    // Shared dependency edit reruns only the matching file.
    expect(
      planWatchRerun({
        projectEntries,
        previousTestFiles,
        affectedTestFiles: ['/basic.test.ts', '/snap.test.ts'],
        filterTestPaths: onlyBasic,
      }).decision,
    ).toEqual({
      kind: 'rerun',
      testPaths: ['/basic.test.ts'],
      message: 'Re-running 1 affected test file(s)...\n',
    });

    // `requestedTestPaths: 'all'` (e.g. `t`) respects the active file filter.
    expect(
      planWatchRerun({
        projectEntries,
        previousTestFiles,
        affectedTestFiles: [],
        requestedTestPaths: 'all',
        filterTestPaths: onlyBasic,
      }).decision,
    ).toEqual({
      kind: 'rerun',
      testPaths: ['/basic.test.ts'],
      message: 'Re-running 1 affected test file(s)...\n',
    });

    // Explicit paths (e.g. `f`/`u`) run even when outside the active file filter.
    expect(
      planWatchRerun({
        projectEntries,
        previousTestFiles,
        affectedTestFiles: [],
        requestedTestPaths: ['/snap.test.ts'],
        filterTestPaths: onlyBasic,
      }).decision,
    ).toEqual({
      kind: 'rerun',
      testPaths: ['/snap.test.ts'],
      message: 'Re-running 1 affected test file(s)...\n',
    });
  });

  it('commits unfiltered disk additions while filtering rerun decisions', () => {
    const previousTestFiles = [
      { testPath: '/basic.test.ts', projectName: 'project-a' },
    ];
    const onlyBasic = (paths: string[]) =>
      paths.filter((filePath) => filePath.includes('basic'));

    // Adding an unrelated file updates lastTestFiles without rerunning basic.
    const unrelatedAdd = planWatchRerun({
      projectEntries: [
        {
          project: { name: 'project-a' },
          testFiles: ['/basic.test.ts', '/other.test.ts'],
        },
      ],
      previousTestFiles,
      affectedTestFiles: [],
      filterTestPaths: onlyBasic,
    });
    expect(unrelatedAdd.fileSetUpdate?.currentTestFiles).toHaveLength(2);
    expect(unrelatedAdd.decision.kind).toBe('idle');

    // Adding a matching file reruns the matching subset.
    const matchingAdd = planWatchRerun({
      projectEntries: [
        {
          project: { name: 'project-a' },
          testFiles: [
            '/basic.test.ts',
            '/basic-extra.test.ts',
            '/other.test.ts',
          ],
        },
      ],
      previousTestFiles: unrelatedAdd.fileSetUpdate!.currentTestFiles,
      affectedTestFiles: [],
      filterTestPaths: onlyBasic,
    });
    expect(matchingAdd.decision).toEqual({
      kind: 'rerun',
      testPaths: ['/basic.test.ts', '/basic-extra.test.ts'],
      message: 'Test file set changed, re-running 2 file(s)...\n',
    });

    // Deleting the last matching file emits an empty decision so core prunes it.
    const matchingDelete = planWatchRerun({
      projectEntries: [
        {
          project: { name: 'project-a' },
          testFiles: ['/other.test.ts'],
        },
      ],
      previousTestFiles: [
        { testPath: '/basic.test.ts', projectName: 'project-a' },
        { testPath: '/other.test.ts', projectName: 'project-a' },
      ],
      affectedTestFiles: [],
      filterTestPaths: onlyBasic,
    });
    expect(matchingDelete.fileSetUpdate?.deletedTestPaths).toEqual([
      '/basic.test.ts',
    ]);
    expect(matchingDelete.decision.kind).toBe('empty');
  });
});
