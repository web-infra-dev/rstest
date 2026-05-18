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
      await generateCoverage(context, createCoverageMap(), provider);
      expect(batches).toEqual([25, 25, 5]);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
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
      await generateCoverage(context, coverageMap, provider);
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
      await generateCoverage(context, createCoverageMap(), provider);
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
