import { describe, expect, it } from '@rstest/core';
import type { TestInfo } from '@rstest/core/internal/browser-runtime';
import type { CaseInfo } from '../utils/constants';
import {
  buildCollectedCaseMap,
  projectCaseInfo,
  upsertRunningCase,
} from './caseMap';

type CollectedCaseInfo = Extract<TestInfo, { type: 'case' }>;

describe('buildCollectedCaseMap', () => {
  it('should flatten collected suites into leaf cases and preserve existing statuses', () => {
    const previousCases: Record<string, CaseInfo> = {
      'case-1': {
        id: 'case-1',
        name: 'renders title',
        parentNames: ['component', 'header'],
        fullName: 'component  header  renders title',
        status: 'running',
        filePath: '/tests/example.test.tsx',
      },
    };

    const tests: TestInfo[] = [
      {
        testId: 'suite-1',
        type: 'suite',
        name: 'component',
        parentNames: [],
        testPath: '/tests/example.test.tsx',
        project: 'browser-react',
        runMode: 'run',
        tests: [
          {
            testId: 'suite-2',
            type: 'suite',
            name: 'header',
            parentNames: ['component'],
            testPath: '/tests/example.test.tsx',
            project: 'browser-react',
            runMode: 'run',
            tests: [
              {
                testId: 'case-1',
                type: 'case',
                name: 'renders title',
                parentNames: ['component', 'header'],
                testPath: '/tests/example.test.tsx',
                project: 'browser-react',
                runMode: 'run',
                location: { line: 12, column: 3 },
              },
            ],
          },
        ],
      },
      {
        testId: 'case-2',
        type: 'case',
        name: 'renders footer',
        parentNames: [],
        testPath: '/tests/example.test.tsx',
        project: 'browser-react',
        runMode: 'run',
        location: { line: 24, column: 5 },
      },
    ];

    const caseMap = buildCollectedCaseMap({
      filePath: '/tests/example.test.tsx',
      tests,
      previousCases,
    });

    expect(Object.keys(caseMap)).toEqual(['case-1', 'case-2']);
    expect(caseMap['case-1']).toEqual({
      id: 'case-1',
      name: 'renders title',
      parentNames: ['component', 'header'],
      fullName: 'component  header  renders title',
      status: 'running',
      filePath: '/tests/example.test.tsx',
      location: { line: 12, column: 3 },
    });
    expect(caseMap['case-2']).toEqual({
      id: 'case-2',
      name: 'renders footer',
      parentNames: [],
      fullName: 'renders footer',
      status: 'idle',
      filePath: '/tests/example.test.tsx',
      location: { line: 24, column: 5 },
    });
  });

  it('should mark an existing collected case as running when case-start arrives', () => {
    const previousCases: Record<string, CaseInfo> = {
      'case-1': {
        id: 'case-1',
        name: 'renders title',
        parentNames: ['component', 'header'],
        fullName: 'component  header  renders title',
        status: 'idle',
        filePath: '/tests/example.test.tsx',
        location: { line: 12, column: 3 },
      },
    };

    const test: CollectedCaseInfo = {
      testId: 'case-1',
      type: 'case',
      name: 'renders title',
      parentNames: ['component', 'header'],
      testPath: '/tests/example.test.tsx',
      project: 'browser-react',
      runMode: 'run',
    };

    const caseMap = upsertRunningCase({
      filePath: '/tests/example.test.tsx',
      test,
      previousCases,
    });

    expect(caseMap).toEqual({
      'case-1': {
        id: 'case-1',
        name: 'renders title',
        parentNames: ['component', 'header'],
        fullName: 'component  header  renders title',
        status: 'running',
        filePath: '/tests/example.test.tsx',
        location: { line: 12, column: 3 },
      },
    });
  });

  it('should upsert a running case when case-start arrives before file-ready', () => {
    const test: CollectedCaseInfo = {
      testId: 'case-2',
      type: 'case',
      name: 'renders footer',
      parentNames: ['component'],
      testPath: '/tests/example.test.tsx',
      project: 'browser-react',
      runMode: 'run',
      location: { line: 24, column: 5 },
    };

    const caseMap = upsertRunningCase({
      filePath: '/tests/example.test.tsx',
      test,
      previousCases: {},
    });

    expect(caseMap).toEqual({
      'case-2': {
        id: 'case-2',
        name: 'renders footer',
        parentNames: ['component'],
        fullName: 'component  renders footer',
        status: 'running',
        filePath: '/tests/example.test.tsx',
        location: { line: 24, column: 5 },
      },
    });
  });
});

describe('projectCaseInfo', () => {
  it('falls back to the file path (two-tier) when no previousCase is given', () => {
    const info = projectCaseInfo({
      filePath: '/file.test.ts',
      test: { testId: 'c1', name: 'n', testPath: '' },
      status: 'pass',
    });
    // Empty testPath falls through to filePath, never to a previousCase tier.
    expect(info.filePath).toBe('/file.test.ts');
    expect(info.location).toBeUndefined();
  });

  it('uses previousCase filePath/location only when test omits them', () => {
    const previousCase: CaseInfo = {
      id: 'c1',
      name: 'n',
      parentNames: [],
      fullName: 'n',
      status: 'running',
      filePath: '/prev.test.ts',
      location: { line: 9, column: 1 },
    };
    const info = projectCaseInfo({
      filePath: '/file.test.ts',
      test: { testId: 'c1', name: 'n' },
      status: 'pass',
      previousCase,
    });
    expect(info.filePath).toBe('/prev.test.ts');
    expect(info.location).toEqual({ line: 9, column: 1 });
  });

  it('takes location verbatim from the test when present', () => {
    const info = projectCaseInfo({
      filePath: '/file.test.ts',
      test: {
        testId: 'c1',
        name: 'n',
        testPath: '/file.test.ts',
        location: { line: 3, column: 2 },
      },
      status: 'fail',
    });
    expect(info.location).toEqual({ line: 3, column: 2 });
  });

  it('joins parentNames into fullName with a double space, falling back to name', () => {
    expect(
      projectCaseInfo({
        filePath: '/f.test.ts',
        test: { testId: 'c1', name: 'renders' },
        status: 'pass',
      }).fullName,
    ).toBe('renders');

    expect(
      projectCaseInfo({
        filePath: '/f.test.ts',
        test: { testId: 'c1', name: 'renders', parentNames: ['a', 'b'] },
        status: 'pass',
      }).fullName,
    ).toBe('a  b  renders');
  });

  it('drops falsy parentNames entries', () => {
    const info = projectCaseInfo({
      filePath: '/f.test.ts',
      test: {
        testId: 'c1',
        name: 'n',
        parentNames: ['a', '', 'b'] as string[],
      },
      status: 'pass',
    });
    expect(info.parentNames).toEqual(['a', 'b']);
    expect(info.fullName).toBe('a  b  n');
  });
});
