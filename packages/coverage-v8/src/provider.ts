import fs from 'node:fs/promises';
import inspector from 'node:inspector/promises';
import { fileURLToPath } from 'node:url';
import type {
  CoverageOptions,
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import astV8ToIstanbul from 'ast-v8-to-istanbul';
import { Parser } from 'acorn';
import istanbulLibCoverage, {
  type CoverageMap,
  type FileCoverageData,
} from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import picomatch from 'picomatch';
import v8ToIstanbul from 'v8-to-istanbul';

type SourceMapLike = {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  file?: string;
  sourceRoot?: string;
  sourcesContent?: (string | null)[];
};

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
      this.root = this.normalizeForMatching(this.root);
    }

    this.isIncluded = options.include?.length
      ? picomatch(options.include)
      : () => true;

    this.isExcluded = options.exclude?.length
      ? picomatch(options.exclude)
      : () => false;

    this.isMatch = (filePath: string) => {
      if (
        filePath.includes('/node_modules/') ||
        filePath.includes('@rstest/')
      ) {
        return false;
      }

      return true;
    };
  }

  private normalizeForMatching(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLowerCase();
  }

  private toProjectRelativePath(filePath: string): string {
    const normalizedFilePath = this.normalizeForMatching(filePath);

    if (!this.root) {
      return normalizedFilePath;
    }

    if (normalizedFilePath === this.root) {
      return '';
    }

    if (normalizedFilePath.startsWith(`${this.root}/`)) {
      return normalizedFilePath.slice(this.root.length + 1);
    }

    return normalizedFilePath;
  }

  private findInDict(
    dict: Record<string, string> | undefined,
    filePath: string,
  ): string | undefined {
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
  }

  private shouldIgnoreTransformedFile(filepath: string): boolean {
    const normalizedFilepath = filepath.replace(/\\/g, '/');
    return (
      normalizedFilepath.includes('/node_modules/') ||
      normalizedFilepath.includes('@rstest/')
    );
  }

  private async getTransformedSource(
    filePath: string,
    options?: {
      assetFiles?: Record<string, string>;
      sourceMaps?: Record<string, string>;
    },
  ): Promise<{
    code: string;
    sourceMap?: SourceMapLike;
  }> {
    const assetSource = this.findInDict(options?.assetFiles, filePath);
    const sourceMapStr = this.findInDict(options?.sourceMaps, filePath);

    return {
      code: assetSource ?? (await fs.readFile(filePath, 'utf-8')),
      sourceMap: sourceMapStr
        ? ({
            names: [],
            ...(JSON.parse(sourceMapStr) as Partial<SourceMapLike>),
          } as SourceMapLike)
        : undefined,
    };
  }

  private parseAst(code: string) {
    const parseOptions = {
      ecmaVersion: 'latest' as const,
      locations: true,
      ranges: true,
    };

    try {
      return Parser.parse(code, {
        ...parseOptions,
        sourceType: 'module',
      });
    } catch {
      return Parser.parse(code, {
        ...parseOptions,
        sourceType: 'script',
      });
    }
  }

  private getConversionMode(): 'ast' | 'fallback' | 'auto' {
    const mode = process.env.RSTEST_V8_CONVERTER;
    if (mode === 'ast' || mode === 'fallback') {
      return mode;
    }

    return 'auto';
  }

  private async convertWithAst(
    filePath: string,
    entry: inspector.Profiler.ScriptCoverage,
    options?: {
      assetFiles?: Record<string, string>;
      sourceMaps?: Record<string, string>;
    },
  ): Promise<Record<string, FileCoverageData>> {
    const { code, sourceMap } = await this.getTransformedSource(
      filePath,
      options,
    );
    const ast = this.parseAst(code);

    return (await astV8ToIstanbul({
      ast,
      code,
      sourceMap,
      coverage: {
        url: entry.url,
        functions: entry.functions,
      },
    })) as Record<string, FileCoverageData>;
  }

  private async convertWithFallback(
    filePath: string,
    entry: inspector.Profiler.ScriptCoverage,
    options?: {
      assetFiles?: Record<string, string>;
      sourceMaps?: Record<string, string>;
    },
  ): Promise<Record<string, FileCoverageData>> {
    const { code, sourceMap } = await this.getTransformedSource(
      filePath,
      options,
    );
    const converterOptions = sourceMap
      ? {
          source: code,
          sourceMap: { sourcemap: sourceMap },
        }
      : {
          source: code,
        };
    const converter = v8ToIstanbul(filePath, 0, converterOptions, (filepath) =>
      this.shouldIgnoreTransformedFile(filepath),
    );

    await converter.load();
    converter.applyCoverage(entry.functions);
    const istanbulData = converter.toIstanbul() as Record<
      string,
      FileCoverageData
    >;
    converter.destroy();
    return istanbulData;
  }

  private filterCoverageData(istanbulData: Record<string, FileCoverageData>) {
    for (const key of Object.keys(istanbulData)) {
      const originalTestPath = this.toProjectRelativePath(key);

      if (
        this.isExcluded(originalTestPath) ||
        !this.isIncluded(originalTestPath)
      ) {
        delete istanbulData[key];
      }
    }
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

  collect(options?: {
    assetFiles?: Record<string, string>;
    sourceMaps?: Record<string, string>;
  }): Promise<CoverageMap | null> {
    return this.collectImpl(options);
  }

  private async collectImpl(options?: {
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

    await Promise.all(
      coverage.result.map(async (entry) => {
        if (!entry.url.startsWith('file://')) return;

        const filePath = fileURLToPath(entry.url).replace(/\\/g, '/');

        if (!this.isMatch(filePath)) return;

        try {
          let istanbulData: Record<string, FileCoverageData>;
          const conversionMode = this.getConversionMode();

          if (conversionMode === 'ast') {
            istanbulData = await this.convertWithAst(filePath, entry, options);
          } else if (conversionMode === 'fallback') {
            istanbulData = await this.convertWithFallback(
              filePath,
              entry,
              options,
            );
          } else {
            try {
              istanbulData = await this.convertWithAst(
                filePath,
                entry,
                options,
              );
            } catch {
              istanbulData = await this.convertWithFallback(
                filePath,
                entry,
                options,
              );
            }
          }

          this.filterCoverageData(istanbulData);
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
            ]);
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
    this.session?.disconnect();
    this.session = null;
  }
}
