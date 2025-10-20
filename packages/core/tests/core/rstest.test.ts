import { join } from 'pathe';
import { Rstest } from '../../src/core/rstest';

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
});
