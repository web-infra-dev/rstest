import fs from 'node:fs/promises';
import inspector from 'node:inspector/promises';
import { fileURLToPath } from 'node:url';
import type {
  CoverageOptions,
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import istanbulLibCoverage, {
  type CoverageMap,
  type FileCoverageData,
} from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import picomatch from 'picomatch';
import v8ToIstanbul from 'v8-to-istanbul';

export class CoverageProvider implements RstestCoverageProvider {
  private session: inspector.Session | null = null;
  private isMatch: (filePath: string) => boolean;
  private isIncluded: (filePath: string) => boolean;
  private isExcluded: (filePath: string) => boolean;

  constructor(
    public options: NormalizedCoverageOptions,
    public root?: string,
  ) {
    if (this.root) {
      this.root = this.root.replace(/\\/g, '/');
    }

    this.isIncluded = options.include?.length
      ? picomatch(options.include)
      : () => true;

    this.isExcluded = options.exclude?.length
      ? picomatch(options.exclude)
      : () => false;

    this.isMatch = (filePath: string) => {
      // Fast path for obviously ignored directories.
      if (
        filePath.includes('/node_modules/') ||
        filePath.includes('@rstest/')
      ) {
        return false;
      }

      return true;
    };
  }

  async init(): Promise<void> {
    this.session = new inspector.Session();
    this.session.connect();
    await this.session.post('Profiler.enable');
    await this.session.post('Profiler.startPreciseCoverage', {
      callCount: true,
      detailed: true,
    });
  }

  async collect(options?: {
    assetFiles?: Record<string, string>;
    sourceMaps?: Record<string, string>;
  }): Promise<CoverageMap | null> {
    if (!this.session) return null;

    let coverage: inspector.Profiler.TakePreciseCoverageReturnType;
    try {
      coverage = await this.session.post('Profiler.takePreciseCoverage');
    } finally {
      try {
        await this.session.post('Profiler.stopPreciseCoverage');
        await this.session.post('Profiler.disable');
      } catch (_err) {
        // Ignore teardown errors to prevent masking original errors
      }
    }

    const coverageMap = this.createCoverageMap();

    const findInDict = (
      dict: Record<string, string> | undefined,
      filePath: string,
    ): string | undefined => {
      if (!dict) return undefined;
      if (dict[filePath]) return dict[filePath];

      for (const [key, value] of Object.entries(dict)) {
        const normalizedKey = key.replace(/\\/g, '/');
        if (normalizedKey === filePath) return value;
        if (
          filePath.startsWith('/private/') &&
          normalizedKey === filePath.slice('/private'.length)
        ) {
          return value;
        }
        if (normalizedKey.toLowerCase() === filePath.toLowerCase()) {
          return value;
        }
      }
      return undefined;
    };

    await Promise.all(
      coverage.result.map(async (entry) => {
        if (!entry.url.startsWith('file://')) return;

        const filePath = fileURLToPath(entry.url).replace(/\\/g, '/');

        if (!this.isMatch(filePath)) return;

        try {
          const assetSource = findInDict(options?.assetFiles, filePath);
          const sourceMapStr = findInDict(options?.sourceMaps, filePath);

          const converter = v8ToIstanbul(
            filePath,
            0,
            assetSource
              ? {
                  source: assetSource,
                  sourceMap: sourceMapStr
                    ? { sourcemap: JSON.parse(sourceMapStr) }
                    : undefined,
                }
              : { source: await fs.readFile(filePath, 'utf-8') },
            (filepath) => {
              const normalizedFilepath = filepath.replace(/\\/g, '/');
              return (
                normalizedFilepath.includes('/node_modules/') ||
                normalizedFilepath.includes('@rstest/')
              );
            },
          );

          await converter.load();
          converter.applyCoverage(entry.functions);
          const istanbulData = converter.toIstanbul();
          converter.destroy();

          for (const key of Object.keys(istanbulData)) {
            // Apply include/exclude logic on the resolved original file path
            const originalTestPath =
              this.root && key.startsWith(this.root)
                ? key.slice(this.root.length).replace(/^\/+/, '')
                : key;

            if (
              this.isExcluded(originalTestPath) ||
              !this.isIncluded(originalTestPath)
            ) {
              delete istanbulData[key];
            }
          }

          coverageMap.merge(istanbulData);
        } catch (e) {
          console.warn(`Failed to process coverage for ${entry.url}:`, e);
        }
      }),
    );

    return coverageMap;
  }

  createCoverageMap(): CoverageMap {
    return istanbulLibCoverage.createCoverageMap({});
  }
  async generateCoverageForUntestedFiles({
    files,
  }: {
    environmentName?: string;
    files: string[];
  }): Promise<FileCoverageData[]> {
    const CHUNK_SIZE = 100;
    const results: (FileCoverageData | null)[] = [];
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (file) => {
          try {
            const converter = v8ToIstanbul(file, 0, undefined, () => false);
            await converter.load();
            converter.applyCoverage([
              {
                functionName: '(empty-report)',
                ranges: [{ startOffset: 0, endOffset: 0, count: 0 }],
                isBlockCoverage: true,
              },
            ]); // Empty coverage array workaround
            const istanbulData = converter.toIstanbul();
            converter.destroy();
            const keys = Object.keys(istanbulData);
            if (keys.length > 0) {
              return istanbulData[keys[0] as string] as FileCoverageData;
            }
          } catch {
            // Silently ignore failures (e.g. file deleted between test and coverage generation)
          }
          return null;
        }),
      );
      results.push(...chunkResults);
    }
    return results.filter((res): res is FileCoverageData => res !== null);
  }
  async generateReports(
    coverageMap: CoverageMap,
    options?: CoverageOptions,
  ): Promise<void> {
    const opts = { ...this.options, ...(options || {}) };

    const context = createContext({
      dir: opts.reportsDirectory,
      coverageMap: coverageMap,
    });

    const reportersList = opts.reporters || ['text', 'html', 'json'];
    for (const reporter of reportersList) {
      if (typeof reporter === 'object' && 'execute' in reporter) {
        reporter.execute(context);
      } else {
        const [reporterName, reporterOptions] = Array.isArray(reporter)
          ? reporter
          : [reporter, {}];
        const report = reports.create(reporterName as any, reporterOptions);
        report.execute(context);
      }
    }
  }
  cleanup(): void {
    if (this.session) {
      this.session.disconnect();
      this.session = null;
    }
  }
}
