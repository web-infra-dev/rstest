import { describe, expect, it } from '@rstest/core';
import type { TestInfo } from '@rstest/core/browser-runtime';
import type { CaseInfo } from '../utils/constants';
import { buildCollectedCaseMap } from './caseMap';

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
});
