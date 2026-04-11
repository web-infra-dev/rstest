import { join } from 'pathe';
import { Rstest } from '../../src/core/rstest';

// Mock std-env to ensure consistent snapshot across environments
rs.mock('std-env', () => ({
  isCI: false,
}));

process.env.DEBUG = 'false';

const rootPath = join(__dirname, '../..');

describe('rstest context', () => {
  it('should generate rstest context correctly', async () => {
    const rstestContext = new Rstest(
      {
        cwd: rootPath,
        command: 'run',
        projects: [],
      },
      {},
    );

    expect(rstestContext.projects[0]!.normalizedConfig).toMatchSnapshot();
  });

  it('should generate rstest context correctly with multiple projects', async () => {
    const rstestContext = new Rstest(
      {
        cwd: rootPath,
        command: 'run',
        projects: [
          {
            config: {
              root: join(rootPath, 'test-project'),
              name: 'test-project',
              include: ['<rootDir>/tests/**/*.test.ts'],
              setupFiles: '<rootDir>/scripts/rstest.setup.ts',
            },
          },
          {
            config: {
              root: 'test-project1',
              name: 'test-project1',
              setupFiles: ['<rootDir>/scripts/rstest.setup.ts'],
            },
          },
        ],
      },
      {},
    );

    expect(rstestContext.projects[0]!.normalizedConfig).toMatchSnapshot();
    expect(rstestContext.projects[1]!.normalizedConfig).toMatchSnapshot();
  });

  it('should clear stale test case results when a file only reports a file-level result', () => {
    const rstestContext = new Rstest(
      {
        cwd: rootPath,
        command: 'watch',
        projects: [],
      },
      {},
    );

    rstestContext.updateReporterResultState(
      [
        {
          status: 'pass',
          name: 'math.test.ts',
          testPath: '/test/root/math.test.ts',
          duration: 10,
          results: [],
          project: 'rstest',
          testId: 'file-pass',
        },
      ],
      [
        {
          status: 'pass',
          name: 'adds',
          testPath: '/test/root/math.test.ts',
          duration: 5,
          project: 'rstest',
          testId: 'case-pass',
        },
      ],
    );

    rstestContext.updateReporterResultState(
      [
        {
          status: 'fail',
          name: 'math.test.ts',
          testPath: '/test/root/math.test.ts',
          duration: 0,
          results: [],
          errors: [
            {
              name: 'Error',
              message: 'Module build failed',
            },
          ],
          project: 'rstest',
          testId: 'file-fail',
        },
      ],
      [],
    );

    expect(rstestContext.reporterResults.results).toHaveLength(1);
    expect(rstestContext.reporterResults.results[0]!.status).toBe('fail');
    expect(rstestContext.reporterResults.testResults).toEqual([]);
  });
});
