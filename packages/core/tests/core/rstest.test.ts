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

  it('propagates the global-only resolveSnapshotPath into every project config', () => {
    const resolveSnapshotPath = (testPath: string, snapExtension: string) =>
      join(rootPath, 'custom-snapshots', `${testPath}${snapExtension}`);

    const rstestContext = new Rstest(
      {
        cwd: rootPath,
        command: 'run',
        projects: [
          { config: { root: join(rootPath, 'a'), name: 'a' } },
          { config: { root: join(rootPath, 'b'), name: 'b' } },
        ],
      },
      { resolveSnapshotPath },
    );

    // `resolveSnapshotPath` is global-only (omitted from ProjectConfig), so each
    // project must inherit the root resolver — otherwise the node pool resolves
    // per-project snapshots to the DEFAULT path while the browser host (which
    // reads root) honors the custom one. Both executors must agree.
    for (const project of rstestContext.projects) {
      expect(project.normalizedConfig.resolveSnapshotPath).toBe(
        resolveSnapshotPath,
      );
    }
  });

  it('propagates the global-only onConsoleLog into every project config', () => {
    const onConsoleLog = () => false;

    const rstestContext = new Rstest(
      {
        cwd: rootPath,
        command: 'run',
        projects: [
          { config: { root: join(rootPath, 'a'), name: 'a' } },
          { config: { root: join(rootPath, 'b'), name: 'b' } },
        ],
      },
      { onConsoleLog },
    );

    // `onConsoleLog` is global-only (omitted from ProjectConfig). The per-project
    // event pump (RunnerEventSink) reads it per-project, so without propagation
    // the node pool ignores the root filter in multi-project runs while the
    // browser host (reads root) honors it. Both executors must agree.
    for (const project of rstestContext.projects) {
      expect(project.normalizedConfig.onConsoleLog).toBe(onConsoleLog);
    }
  });
});
