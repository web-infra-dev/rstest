import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import {
  cleanCoverageReports,
  createCoverageProvider,
  ensureCoverageProviderInstalled,
} from '../../src/coverage';
import { createExitCode } from '../../src/core/exitCode';
import { mergeReports } from '../../src/core/mergeReports';
import { prepareRsbuild } from '../../src/core/rsbuild';
import { generateCoverage } from '../../src/coverage/generate';
import { parseBlobFile } from '../../src/reporter/blob';
import type { Rstest } from '../../src/core/rstest';

rs.mock('../../src/coverage', () => ({
  cleanCoverageReports: rs.fn(),
  createCoverageProvider: rs.fn(async () => null),
  ensureCoverageProviderInstalled: rs.fn(async () => {}),
}));

rs.mock('../../src/core/rsbuild', () => ({
  prepareRsbuild: rs.fn(async () => ({
    initConfigs: rs.fn(async () => []),
  })),
}));

rs.mock('../../src/coverage/generate', () => ({
  generateCoverage: rs.fn(async () => {}),
}));

rs.mock('../../src/reporter/blob', () => ({
  blobFileKey: rs.fn(),
  blobFileKeyProject: rs.fn(),
  isBlobFile: () => true,
  parseBlobFile: rs.fn(() => ({
    duration: { buildTime: 0, testTime: 0, totalTime: 0 },
    files: {},
    results: [],
    projects: ['old-project'],
    snapshotSummary: {
      added: 0,
      didUpdate: false,
      failure: false,
      filesAdded: 0,
      filesRemoved: 0,
      filesRemovedList: [],
      filesUnmatched: 0,
      filesUpdated: 0,
      matched: 0,
      total: 0,
      unchecked: 0,
      uncheckedKeysByFile: [],
      unmatched: 0,
      updated: 0,
    },
    testResults: [],
  })),
}));

const ensureCoverageProviderInstalledSpy = rs.mocked(
  ensureCoverageProviderInstalled,
);
const prepareRsbuildSpy = rs.mocked(prepareRsbuild);
const cleanCoverageReportsSpy = rs.mocked(cleanCoverageReports);
const createCoverageProviderSpy = rs.mocked(createCoverageProvider);
const generateCoverageSpy = rs.mocked(generateCoverage);
const parseBlobFileSpy = rs.mocked(parseBlobFile);

describe('mergeReports', () => {
  let rootPath: string;

  beforeEach(() => {
    rootPath = mkdtempSync(join(tmpdir(), 'rstest-merge-reports-'));
    mkdirSync(join(rootPath, '.rstest-reports'));
    writeFileSync(join(rootPath, '.rstest-reports/blob.json'), '{}');
    ensureCoverageProviderInstalledSpy.mockClear();
    prepareRsbuildSpy.mockClear();
    cleanCoverageReportsSpy.mockClear();
    createCoverageProviderSpy.mockClear();
    generateCoverageSpy.mockClear();
    parseBlobFileSpy.mockClear();
  });

  afterEach(() => {
    rmSync(rootPath, { recursive: true, force: true });
  });

  it('installs the coverage provider before preparing Rsbuild for included files', async () => {
    const context = {
      normalizedConfig: {
        coverage: { enabled: true, include: ['src/**'] },
      },
      projects: [],
      reporters: [],
      rootPath,
      exitCode: createExitCode(),
    } as unknown as Rstest;

    await mergeReports(context);

    expect(ensureCoverageProviderInstalledSpy).toHaveBeenCalledWith(
      context.normalizedConfig.coverage,
      rootPath,
      {},
    );
    expect(
      ensureCoverageProviderInstalledSpy.mock.invocationCallOrder[0],
    ).toBeLessThan(prepareRsbuildSpy.mock.invocationCallOrder[0]!);
  });

  it('lets coverage generation fall back when blob project names changed', async () => {
    createCoverageProviderSpy.mockResolvedValue({
      createCoverageMap: () => ({
        merge() {},
      }),
    } as never);

    const currentProject = { name: 'renamed-project' };
    const context = {
      normalizedConfig: {
        coverage: { enabled: true, include: ['src/**'] },
      },
      projects: [currentProject],
      reporters: [],
      rootPath,
      exitCode: createExitCode(),
    } as unknown as Rstest;

    await mergeReports(context);

    expect(generateCoverageSpy).toHaveBeenCalledWith(
      context,
      expect.anything(),
      expect.anything(),
      undefined,
      undefined,
      undefined,
    );
  });
});
