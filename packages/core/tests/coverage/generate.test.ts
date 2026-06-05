import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import { withDefaultConfig } from '../../src/config';
import {
  filterChangedFiles,
  generateCoverage,
} from '../../src/coverage/generate';
import type { RstestContext } from '../../src/types';
import type { CoverageMap, CoverageProvider } from '../../src/types/coverage';
import type { TraceSpan } from '../../src/utils';

const createFileCoverage = (file: string): FileCoverageData => ({
  path: file,
  statementMap: {},
  fnMap: {},
  branchMap: {},
  s: {},
  f: {},
  b: {},
  all: false,
  _coverageSchema: 'test',
  hash: file,
});

const createCoverageMap = (
  coveredFiles = new Map<string, FileCoverageData>(),
): CoverageMap =>
  ({
    addFileCoverage(coverage: FileCoverageData) {
      coveredFiles.set(coverage.path, coverage);
    },
    files() {
      return Array.from(coveredFiles.keys());
    },
    filter(predicate: (filePath: string) => boolean) {
      for (const filePath of Array.from(coveredFiles.keys())) {
        if (!predicate(filePath)) {
          coveredFiles.delete(filePath);
        }
      }
    },
    merge(coverage: Record<string, FileCoverageData>) {
      Object.entries(coverage).forEach(([filePath, fileCoverage]) => {
        coveredFiles.set(filePath, fileCoverage);
      });
    },
  }) as CoverageMap;

describe('generateCoverage', () => {
  it('batches untested files before asking the provider to instrument them', async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-'));
    const srcDir = path.join(rootPath, 'src');
    mkdirSync(srcDir, { recursive: true });

    for (let index = 0; index < 55; index++) {
      writeFileSync(
        path.join(srcDir, `file-${index}.ts`),
        `export const value${index} = ${index};\n`,
      );
    }

    const defaultCoverage = withDefaultConfig({}).coverage;
    const batches: number[] = [];

    const provider = {
      init: () => {},
      collect: () => null,
      cleanup: () => {},
      createCoverageMap: () => createCoverageMap(),
      async generateCoverageForUntestedFiles({ files }) {
        batches.push(files.length);
        return files.map(createFileCoverage);
      },
      async generateReports() {},
    } satisfies CoverageProvider;

    const context = {
      rootPath,
      normalizedConfig: {
        coverage: {
          ...defaultCoverage,
          include: ['src/**/*.ts'],
        },
      },
      projects: [
        {
          rootPath,
          environmentName: 'node',
        },
      ],
    } as RstestContext;

    try {
      await generateCoverage(
        context.projects,
        context,
        createCoverageMap(),
        provider,
      );
      expect(batches).toEqual([25, 25, 5]);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('only instruments untested files for the scheduled (built) projects', async () => {
    // A project configured but NOT built this round (e.g. a node sibling that
    // matched zero files, or a browser project) must be skipped, so its
    // environment's swc transform is never demanded (would throw otherwise).
    const scheduledRoot = mkdtempSync(
      path.join(tmpdir(), 'rstest-coverage-scheduled-'),
    );
    const unscheduledRoot = mkdtempSync(
      path.join(tmpdir(), 'rstest-coverage-unscheduled-'),
    );
    for (const root of [scheduledRoot, unscheduledRoot]) {
      const srcDir = path.join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(path.join(srcDir, 'index.ts'), 'export const value = 1;\n');
    }

    const defaultCoverage = withDefaultConfig({}).coverage;
    const instrumented: string[] = [];

    const provider = {
      init: () => {},
      collect: () => null,
      cleanup: () => {},
      createCoverageMap: () => createCoverageMap(),
      async generateCoverageForUntestedFiles({ files }) {
        instrumented.push(...files);
        return files.map(createFileCoverage);
      },
      async generateReports() {},
    } satisfies CoverageProvider;

    const scheduledProject = {
      rootPath: scheduledRoot,
      environmentName: 'node',
    };
    const unscheduledProject = {
      rootPath: unscheduledRoot,
      environmentName: 'node-unbuilt',
    };

    const context = {
      rootPath: scheduledRoot,
      normalizedConfig: {
        coverage: {
          ...defaultCoverage,
          include: ['src/**/*.ts'],
          allowExternal: true,
        },
      },
      // Both projects are configured, but only the scheduled one was built.
      projects: [scheduledProject, unscheduledProject],
    } as unknown as RstestContext;

    const norm = (p: string) => p.split('\\').join('/');

    try {
      await generateCoverage(
        [scheduledProject] as unknown as RstestContext['projects'],
        context,
        createCoverageMap(),
        provider,
      );

      expect(instrumented.length).toBeGreaterThan(0);
      expect(
        instrumented.every((f) => norm(f).startsWith(norm(scheduledRoot))),
      ).toBe(true);
      expect(
        instrumented.some((f) => norm(f).startsWith(norm(unscheduledRoot))),
      ).toBe(false);
    } finally {
      rmSync(scheduledRoot, { recursive: true, force: true });
      rmSync(unscheduledRoot, { recursive: true, force: true });
    }
  });

  it('filters setupFiles and globalSetup from the final coverage map for all providers', async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-'));
    const setupFile = path.join(rootPath, 'scripts', 'rstest.setup.ts');
    const globalSetupFile = path.join(rootPath, 'scripts', 'global-setup.ts');
    const sourceFile = path.join(rootPath, 'src', 'index.ts');

    mkdirSync(path.dirname(setupFile), { recursive: true });
    mkdirSync(path.dirname(sourceFile), { recursive: true });
    writeFileSync(setupFile, 'export {};\n');
    writeFileSync(globalSetupFile, 'export {};\n');
    writeFileSync(sourceFile, 'export const value = 1;\n');

    const defaultCoverage = withDefaultConfig({}).coverage;
    const reportedFiles: string[][] = [];

    const provider = {
      init: () => {},
      collect: () => null,
      cleanup: () => {},
      createCoverageMap: () => createCoverageMap(),
      async generateReports(coverageMap) {
        reportedFiles.push(coverageMap.files());
      },
    } satisfies CoverageProvider;

    const coverageMap = createCoverageMap();
    coverageMap.addFileCoverage(createFileCoverage(sourceFile));
    coverageMap.addFileCoverage(createFileCoverage(setupFile));
    coverageMap.addFileCoverage(createFileCoverage(globalSetupFile));

    const context = {
      rootPath,
      normalizedConfig: {
        coverage: defaultCoverage,
        output: {
          distPath: {
            root: 'dist/.rstest-temp',
          },
        },
      },
      projects: [
        {
          rootPath,
          environmentName: 'node',
          normalizedConfig: {
            setupFiles: [setupFile],
            globalSetup: [globalSetupFile],
          },
        },
      ],
    } as RstestContext;

    try {
      await generateCoverage(context.projects, context, coverageMap, provider);
      expect(reportedFiles).toEqual([[sourceFile]]);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('filters relative setupFiles and globalSetup from the final coverage map', async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-'));
    const setupFile = path.join(rootPath, 'scripts', 'rstest.setup.ts');
    const globalSetupFile = path.join(rootPath, 'scripts', 'global-setup.ts');
    const sourceFile = path.join(rootPath, 'src', 'index.ts');

    mkdirSync(path.dirname(setupFile), { recursive: true });
    mkdirSync(path.dirname(sourceFile), { recursive: true });
    writeFileSync(setupFile, 'export {};\n');
    writeFileSync(globalSetupFile, 'export {};\n');
    writeFileSync(sourceFile, 'export const value = 1;\n');

    const defaultCoverage = withDefaultConfig({}).coverage;
    const reportedFiles: string[][] = [];

    const provider = {
      init: () => {},
      collect: () => null,
      cleanup: () => {},
      createCoverageMap: () => createCoverageMap(),
      async generateReports(coverageMap) {
        reportedFiles.push(coverageMap.files());
      },
    } satisfies CoverageProvider;

    const coverageMap = createCoverageMap();
    coverageMap.addFileCoverage(createFileCoverage(sourceFile));
    coverageMap.addFileCoverage(createFileCoverage(setupFile));
    coverageMap.addFileCoverage(createFileCoverage(globalSetupFile));

    const context = {
      rootPath,
      normalizedConfig: {
        coverage: defaultCoverage,
      },
      projects: [
        {
          rootPath,
          environmentName: 'node',
          normalizedConfig: {
            setupFiles: ['./scripts/rstest.setup.ts'],
            globalSetup: ['./scripts/global-setup.ts'],
          },
        },
      ],
    } as RstestContext;

    try {
      await generateCoverage(context.projects, context, coverageMap, provider);
      expect(reportedFiles).toEqual([[sourceFile]]);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('does not treat sibling paths as in-root coverage files', async () => {
    const parentPath = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-'));
    const rootPath = path.join(parentPath, 'app');
    const siblingPath = path.join(parentPath, 'app-sibling');
    const sourceFile = path.join(rootPath, 'src', 'index.ts');
    const siblingFile = path.join(siblingPath, 'src', 'helper.ts');

    mkdirSync(path.dirname(sourceFile), { recursive: true });
    mkdirSync(path.dirname(siblingFile), { recursive: true });
    writeFileSync(sourceFile, 'export const value = 1;\n');
    writeFileSync(siblingFile, 'export const helper = 1;\n');

    const defaultCoverage = withDefaultConfig({}).coverage;
    const reportedFiles: string[][] = [];

    const provider = {
      init: () => {},
      collect: () => null,
      cleanup: () => {},
      createCoverageMap: () => createCoverageMap(),
      async generateReports(coverageMap) {
        reportedFiles.push(coverageMap.files());
      },
    } satisfies CoverageProvider;

    const coverageMap = createCoverageMap();
    coverageMap.addFileCoverage(createFileCoverage(sourceFile));
    coverageMap.addFileCoverage(createFileCoverage(siblingFile));

    const context = {
      rootPath,
      normalizedConfig: {
        coverage: defaultCoverage,
      },
      projects: [
        {
          rootPath,
          environmentName: 'node',
        },
      ],
    } as RstestContext;

    try {
      await generateCoverage(context.projects, context, coverageMap, provider);
      expect(reportedFiles).toEqual([[sourceFile]]);
    } finally {
      rmSync(parentPath, { recursive: true, force: true });
    }
  });

  it('only filters exact runtime sentinel coverage paths', async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-'));
    const sourceFile = path.join(
      rootPath,
      'src',
      'webpack',
      'runtime',
      'index.ts',
    );

    mkdirSync(path.dirname(sourceFile), { recursive: true });
    writeFileSync(sourceFile, 'export const value = 1;\n');

    const defaultCoverage = withDefaultConfig({}).coverage;
    const reportedFiles: string[][] = [];

    const provider = {
      init: () => {},
      collect: () => null,
      cleanup: () => {},
      createCoverageMap: () => createCoverageMap(),
      async generateReports(coverageMap) {
        reportedFiles.push(coverageMap.files());
      },
    } satisfies CoverageProvider;

    const coverageMap = createCoverageMap();
    coverageMap.addFileCoverage(createFileCoverage(sourceFile));
    coverageMap.addFileCoverage(createFileCoverage('webpack/runtime/module'));
    coverageMap.addFileCoverage(createFileCoverage('rstest runtime'));

    const context = {
      rootPath,
      normalizedConfig: {
        coverage: {
          ...defaultCoverage,
          allowExternal: true,
        },
      },
      projects: [
        {
          rootPath,
          environmentName: 'node',
        },
      ],
    } as RstestContext;

    try {
      await generateCoverage(context.projects, context, coverageMap, provider);
      expect(reportedFiles).toEqual([[sourceFile]]);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('limits included coverage files to changed coverage filters', async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-'));
    const srcDir = path.join(rootPath, 'src');
    mkdirSync(srcDir, { recursive: true });

    const changedFile = path.join(srcDir, 'changed.ts');
    writeFileSync(changedFile, 'export const changed = true;\n');
    writeFileSync(
      path.join(srcDir, 'unchanged.ts'),
      'export const unchanged = true;\n',
    );

    const defaultCoverage = withDefaultConfig({}).coverage;

    const provider = {
      init: () => {},
      collect: () => null,
      cleanup: () => {},
      createCoverageMap: () => createCoverageMap(),
      async generateCoverageForUntestedFiles({ files }) {
        return files.map(createFileCoverage);
      },
      async generateReports(coverageMap) {
        expect(coverageMap.files().map(path.normalize)).toEqual([
          path.normalize(changedFile),
        ]);
      },
    } satisfies CoverageProvider;

    const context = {
      rootPath,
      normalizedConfig: {
        coverage: {
          ...defaultCoverage,
          include: ['src/**/*.ts'],
        },
      },
      changedCoverageFilters: [changedFile],
      projects: [
        {
          rootPath,
          environmentName: 'node',
        },
      ],
    } as RstestContext;

    try {
      await generateCoverage(
        context.projects,
        context,
        createCoverageMap(),
        provider,
      );
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('traces coverage generation pipeline steps', async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-'));
    const srcDir = path.join(rootPath, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(
      path.join(srcDir, 'covered.ts'),
      'export const covered = 1;\n',
    );
    writeFileSync(
      path.join(srcDir, 'uncovered.ts'),
      'export const uncovered = 1;\n',
    );

    const coveredFile = path.join(srcDir, 'covered.ts');
    const defaultCoverage = withDefaultConfig({}).coverage;
    const coveredFiles = new Map<string, FileCoverageData>([
      [
        coveredFile,
        {
          path: coveredFile,
          statementMap: {},
          fnMap: {},
          branchMap: {},
          s: {},
          f: {},
          b: {},
          all: false,
          _coverageSchema: 'test',
          hash: coveredFile,
        },
      ],
    ]);

    const createCoverageMap = (): CoverageMap =>
      ({
        addFileCoverage(coverage: { path: string }) {
          coveredFiles.set(coverage.path, coverage);
        },
        files() {
          return Array.from(coveredFiles.keys());
        },
        filter(predicate: (filePath: string) => boolean) {
          for (const filePath of Array.from(coveredFiles.keys())) {
            if (!predicate(filePath)) {
              coveredFiles.delete(filePath);
            }
          }
        },
        merge(coverage: Record<string, FileCoverageData>) {
          Object.entries(coverage).forEach(([filePath, fileCoverage]) => {
            coveredFiles.set(filePath, fileCoverage);
          });
        },
      }) as CoverageMap;

    const provider = {
      init: () => {},
      collect: () => null,
      cleanup: () => {},
      createCoverageMap: () => createCoverageMap(),
      async generateCoverageForUntestedFiles({ files }) {
        return files.map((file) => ({
          path: file,
          statementMap: {},
          fnMap: {},
          branchMap: {},
          s: {},
          f: {},
          b: {},
          all: false,
          _coverageSchema: 'test',
          hash: file,
        }));
      },
      async generateReports() {},
    } satisfies CoverageProvider;

    const context = {
      rootPath,
      normalizedConfig: {
        coverage: {
          ...defaultCoverage,
          include: ['src/**/*.ts'],
        },
      },
      projects: [
        {
          rootPath,
          environmentName: 'node',
        },
      ],
    } as RstestContext;

    const spans: string[] = [];
    const traceSpan: TraceSpan = async (name, _cat, fn) => {
      spans.push(name);
      return fn();
    };

    try {
      await generateCoverage(
        context.projects,
        context,
        createCoverageMap(),
        provider,
        traceSpan,
      );
      expect(spans).toEqual([
        'coverage:filter-files',
        'coverage:collect-covered-files',
        'coverage:collect-included-files',
        'coverage:generate-untested-files',
        'coverage:generate-untested-files-batch',
        'coverage:filter-included-files',
        'coverage:generate-reports',
      ]);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('matches relative changed coverage filters', () => {
    const rootPath = path.join(tmpdir(), 'rstest-coverage-relative');
    const changedFile = path.join(rootPath, 'src/changed.ts');
    const unchangedFile = path.join(rootPath, 'src/unchanged.ts');

    expect(
      filterChangedFiles(
        [changedFile, unchangedFile],
        ['src/changed.ts'],
        rootPath,
      ),
    ).toEqual([changedFile]);
  });
});
