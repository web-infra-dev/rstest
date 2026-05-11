import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import { withDefaultConfig } from '../../src/config';
import { generateCoverage } from '../../src/coverage/generate';
import type { RstestContext } from '../../src/types';
import type { CoverageMap, CoverageProvider } from '../../src/types/coverage';

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
    const coveredFiles = new Map<string, FileCoverageData>();

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
        batches.push(files.length);
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
    const coveredFiles = new Map<string, FileCoverageData>();
    const reportedFiles: string[][] = [];

    const createCoverageMap = (): CoverageMap =>
      ({
        addFileCoverage(coverage: { path: string }) {
          coveredFiles.set(coverage.path, coverage as FileCoverageData);
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
        merge() {},
      }) as CoverageMap;

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
    coverageMap.addFileCoverage({
      path: sourceFile,
      statementMap: {},
      fnMap: {},
      branchMap: {},
      s: {},
      f: {},
      b: {},
      all: false,
      _coverageSchema: 'test',
      hash: sourceFile,
    });
    coverageMap.addFileCoverage({
      path: setupFile,
      statementMap: {},
      fnMap: {},
      branchMap: {},
      s: {},
      f: {},
      b: {},
      all: false,
      _coverageSchema: 'test',
      hash: setupFile,
    });
    coverageMap.addFileCoverage({
      path: globalSetupFile,
      statementMap: {},
      fnMap: {},
      branchMap: {},
      s: {},
      f: {},
      b: {},
      all: false,
      _coverageSchema: 'test',
      hash: globalSetupFile,
    });

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
});
