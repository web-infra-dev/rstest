import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  KnownCoverageStructure,
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import type { CoverageMap, FileCoverageData } from 'istanbul-lib-coverage';
import type { ReportBase } from 'istanbul-lib-report';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import {
  createFastCoverageMap,
  type IstanbulFileCoverageData,
  mapWithConcurrency,
  readInitialCoverage,
  registerSourceMapURL,
  transformCoverage,
} from './utils';

const UNTESTED_FILES_CONCURRENCY = 4;

type StructureKey = 'statementMap' | 'fnMap' | 'branchMap';
type Structure = Pick<IstanbulFileCoverageData, StructureKey>;

const structureKey = (path: string, hash: string): string =>
  JSON.stringify([path, hash]);

type RawCoverage = {
  full: IstanbulFileCoverageData[];
  packed: (Omit<IstanbulFileCoverageData, StructureKey> & { hash: string })[];
};

type CoverageReporterConstructor = new (
  options: Record<string, unknown>,
) => ReportBase;

// Global type declaration for coverage
declare global {
  var __coverage__: any;
}

export class CoverageProvider implements RstestCoverageProvider {
  readonly supportsDeferredCoverageFinalization = true;

  private coverageMap: CoverageMap | null = null;
  private coverageGlobal: typeof globalThis = globalThis;
  private registries = new WeakMap<
    CoverageMap,
    Map<string, KnownCoverageStructure & Structure>
  >();
  // Cache to avoid redundant readFile calls in generateCoverageForUntestedFiles and generateReports.
  private sourcemapUrlCache = new Map<string, string | undefined>();

  constructor(
    private options: NormalizedCoverageOptions,
    private root?: string,
  ) {}

  init(options?: Parameters<RstestCoverageProvider['init']>[0]): void {
    this.coverageGlobal = options?.global ?? globalThis;
    this.coverageGlobal.__coverage__ = this.coverageGlobal.__coverage__ || {};
  }

  async generateCoverageForUntestedFiles({
    environmentName,
    files,
  }: {
    environmentName: string;
    files: string[];
  }): Promise<FileCoverageData[]> {
    const { transformCoverage } = await import('./plugin');

    const { readFile } = await import('node:fs/promises');

    return mapWithConcurrency(
      files,
      UNTESTED_FILES_CONCURRENCY,
      async (file) => {
        try {
          const content = await readFile(file, 'utf-8');
          const { code } = await transformCoverage(
            environmentName,
            content,
            file,
            this.options,
          );
          registerSourceMapURL(file, code, this.sourcemapUrlCache);
          return readInitialCoverage(code);
        } catch (e) {
          console.error(
            `Can not generate coverage for untested file, file: ${file}, error: ${e}`,
          );
          process.exitCode = 1;
          return undefined;
        }
      },
    ).then((results) => results.filter((r): r is FileCoverageData => !!r));
  }

  createCoverageMap(): CoverageMap {
    return createFastCoverageMap();
  }

  collectRaw(
    options?: Parameters<RstestCoverageProvider['collect']>[0],
  ): RawCoverage | null {
    if (!this.coverageGlobal.__coverage__) return null;
    const files: IstanbulFileCoverageData[] = Object.values(
      this.coverageGlobal.__coverage__,
    );
    const known = new Set(
      options?.knownCoverageStructures?.map(({ path, hash }) =>
        structureKey(path, hash),
      ),
    );

    const payload: RawCoverage = { full: [], packed: [] };
    for (const file of files) {
      const { hash } = file;
      if (!hash || !known.has(structureKey(file.path, hash))) {
        payload.full.push(file);
        continue;
      }
      const {
        statementMap: _statementMap,
        fnMap: _fnMap,
        branchMap: _branchMap,
        ...packed
      } = file;
      payload.packed.push({ ...packed, hash });
    }
    return payload;
  }

  getKnownCoverageStructures(map: CoverageMap): KnownCoverageStructure[] {
    return Array.from(
      this.registries.get(map)?.values() ?? [],
      ({ path, hash }) => ({ path, hash }),
    );
  }

  mergeRawCoverage(map: CoverageMap, raw: unknown): void {
    // Core transports opaque data between instances of this same provider.
    const payload = raw as RawCoverage;
    let registry = this.registries.get(map);
    if (!registry) {
      registry = new Map();
      this.registries.set(map, registry);
    }
    const incoming: Record<string, IstanbulFileCoverageData> = {};
    for (const file of payload.full) {
      incoming[file.path] = file;
      if (!file.hash) continue;
      const key = structureKey(file.path, file.hash);
      if (!registry.has(key)) {
        // Native unions replace map containers; keep the original references.
        registry.set(key, {
          path: file.path,
          hash: file.hash,
          statementMap: file.statementMap,
          fnMap: file.fnMap,
          branchMap: file.branchMap,
        });
      }
    }
    for (const packed of payload.packed) {
      // Known structures only list versions already present in this cycle's registry.
      const structure = registry.get(structureKey(packed.path, packed.hash));
      if (!structure) {
        throw new Error(
          `Istanbul coverage invariant violated for ${packed.path}: structure not registered`,
        );
      }
      incoming[packed.path] = {
        ...packed,
        ...structure,
      };
    }
    map.merge(incoming);
  }

  collect(_options?: {
    assetFiles?: Record<string, string>;
    sourceMaps?: Record<string, string>;
  }): CoverageMap | null {
    if (!this.coverageGlobal.__coverage__) {
      return null;
    }

    try {
      if (!this.coverageMap) {
        this.coverageMap = this.createCoverageMap();
      }
      // Merge current coverage data
      if (this.coverageMap) {
        this.coverageMap.merge(this.coverageGlobal.__coverage__);
      }

      return this.coverageMap;
    } catch (error) {
      // Surface collection failures the same way the v8 provider does: log to
      // stderr and mark the run as failed, so a broken coverage map never
      // passes silently with a zero exit code.
      console.error('Failed to collect coverage data:', error);
      process.exitCode = 1;
      return null;
    }
  }

  async generateReports(coverageMap: CoverageMap): Promise<void> {
    const context = createContext({
      dir: this.options.reportsDirectory,
      coverageMap: await transformCoverage(coverageMap, this.sourcemapUrlCache),
    });
    const reportersList = this.options.reporters;
    for (const reporter of reportersList) {
      if (typeof reporter === 'object' && 'execute' in reporter) {
        reporter.execute(context);
      } else {
        const [reporterName, reporterOptions] = Array.isArray(reporter)
          ? reporter
          : [reporter, {}];
        const report = await this.createReport(reporterName, reporterOptions);
        //NOTE: https://github.com/vitest-dev/vitest/blob/41a111c35b6605dbe8a536a6e03b35e9bc0ce770/packages/coverage-istanbul/src/provider.ts#L145
        report.execute(context);
      }
    }
  }

  private async createReport(
    reporterName: string,
    reporterOptions: Record<string, unknown>,
  ): Promise<ReportBase> {
    const resolvedReporterName = this.resolveReporterName(reporterName);

    if (resolvedReporterName.endsWith('.mjs')) {
      const reporterModule = await import(
        this.toImportSpecifier(resolvedReporterName)
      );
      const Reporter = reporterModule.default as CoverageReporterConstructor;

      return new Reporter(reporterOptions);
    }

    try {
      return reports.create(
        resolvedReporterName as Parameters<typeof reports.create>[0],
        reporterOptions,
      );
    } catch (error) {
      if (!this.isRequireEsmError(error)) {
        throw error;
      }
    }

    const reporterModule = await import(
      this.toImportSpecifier(resolvedReporterName)
    );
    const Reporter = reporterModule.default as CoverageReporterConstructor;

    return new Reporter(reporterOptions);
  }

  private resolveReporterName(reporterName: string): string {
    if (reporterName.startsWith('.')) {
      return resolve(this.root ?? process.cwd(), reporterName);
    }

    return reporterName;
  }

  private toImportSpecifier(reporterName: string): string {
    if (isAbsolute(reporterName)) {
      return pathToFileURL(reporterName).toString();
    }

    return reporterName;
  }

  private isRequireEsmError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    return error.code === 'ERR_REQUIRE_ESM';
  }

  cleanup(): void {
    if ('__coverage__' in this.coverageGlobal) {
      delete this.coverageGlobal.__coverage__;
    }
    this.coverageMap = null;
  }
}
