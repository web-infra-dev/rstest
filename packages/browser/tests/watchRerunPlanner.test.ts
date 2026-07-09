import { describe, expect, it } from '@rstest/core';
import {
  collectWatchTestFiles,
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

    expect(plan.filesChanged).toBe(true);
    expect(plan.currentTestFiles).toEqual([
      { testPath: '/a.test.ts', projectName: 'project-a' },
      { testPath: '/b.test.ts', projectName: 'project-a' },
    ]);
  });

  it('should normalize and map affected files to active test entries', () => {
    const projectEntries = [
      {
        project: { name: 'project-a' },
        testFiles: ['tests/a.test.ts', 'tests/b.test.ts'],
      },
    ];

    const plan = planWatchRerun({
      projectEntries,
      previousTestFiles: collectWatchTestFiles(projectEntries),
      affectedTestFiles: ['tests/a.test.ts', 'tests/missing.test.ts'],
    });

    expect(plan.filesChanged).toBe(false);
    expect(plan.normalizedAffectedTestFiles).toEqual([
      'tests/a.test.ts',
      'tests/missing.test.ts',
    ]);
    expect(plan.affectedTestFiles).toEqual([
      { testPath: 'tests/a.test.ts', projectName: 'project-a' },
    ]);
  });

  it('should return empty affected lists when no changes are present', () => {
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

    expect(plan.filesChanged).toBe(false);
    expect(plan.normalizedAffectedTestFiles).toEqual([]);
    expect(plan.affectedTestFiles).toEqual([]);
  });
});
