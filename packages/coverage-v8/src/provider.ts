import fs from 'node:fs/promises';
import inspector from 'node:inspector/promises';
import { posix, win32 } from 'node:path';
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
  private dictLookupCache = new WeakMap<
    Record<string, string>,
    Map<string, string>
  >();

  constructor(
    public options: NormalizedCoverageOptions,
    public root?: string,
  ) {
    if (this.root) {
      this.root = this.normalizeSlashes(this.root);
    }

    this.isIncluded = options.include?.length
      ? picomatch(options.include)
      : () => true;

    this.isExcluded = options.exclude?.length
      ? picomatch(options.exclude)
      : () => false;

    this.isMatch = (filePath: string) =>
      !this.shouldIgnoreTransformedFile(filePath);
  }

  private normalizeForMatching(filePath: string): string {
    return this.normalizeSlashes(filePath).toLowerCase();
  }

  private normalizeSlashes(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  private isAbsolutePath(filePath: string): boolean {
    return posix.isAbsolute(filePath) || win32.isAbsolute(filePath);
  }

  private toProjectRelativePath(filePath: string): string {
    const normalizedFilePath = this.normalizeSlashes(filePath);

    if (!this.root || !this.isAbsolutePath(normalizedFilePath)) {
      return normalizedFilePath;
    }

    if (
      this.normalizeForMatching(normalizedFilePath) ===
      this.normalizeForMatching(this.root)
    ) {
      return '';
    }

    if (win32.isAbsolute(normalizedFilePath) || win32.isAbsolute(this.root)) {
      return win32.relative(this.root, normalizedFilePath).replace(/\\/g, '/');
    }

    return posix.relative(this.root, normalizedFilePath);
  }

  private findInDict(
    dict: Record<string, string> | undefined,
    filePath: string,
  ): string | undefined {
    if (!dict) return undefined;
    if (dict[filePath]) return dict[filePath];

    let lookup = this.dictLookupCache.get(dict);
    if (!lookup) {
      lookup = new Map();
      for (const [key, value] of Object.entries(dict)) {
        const normalizedKey = key.replace(/\\/g, '/');
        if (!lookup.has(normalizedKey)) {
          lookup.set(normalizedKey, value);
        }

        const lowerKey = normalizedKey.toLowerCase();
        if (!lookup.has(lowerKey)) {
          lookup.set(lowerKey, value);
        }
      }
      this.dictLookupCache.set(dict, lookup);
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const directMatch = lookup.get(normalizedPath);
    if (directMatch) return directMatch;

    if (filePath.startsWith('/private/')) {
      const privateMatch = lookup.get(filePath.slice('/private'.length));
      if (privateMatch) return privateMatch;
    }

    return lookup.get(normalizedPath.toLowerCase());
  }

  private isNodeModulesPath(filePath: string): boolean {
    return (
      filePath.startsWith('node_modules/') ||
      filePath.includes('/node_modules/')
    );
  }

  private isRstestInternalModulePath(filePath: string): boolean {
    return (
      filePath.startsWith('node_modules/@rstest/') ||
      filePath.includes('/node_modules/@rstest/')
    );
  }

  private shouldIgnoreTransformedFile(filepath: string): boolean {
    const normalizedFilepath = this.normalizeForMatching(filepath);
    return (
      this.isNodeModulesPath(normalizedFilepath) ||
      this.isRstestInternalModulePath(normalizedFilepath)
    );
  }

  private shouldProcessEntry(filePath: string): boolean {
    const normalizedFilePath = this.normalizeForMatching(filePath);
    const normalizedRoot = this.root
      ? this.normalizeForMatching(this.root)
      : undefined;

    if (this.shouldIgnoreTransformedFile(normalizedFilePath)) {
      return false;
    }

    if (!this.options.allowExternal && normalizedRoot) {
      const relativeFilePath = this.toProjectRelativePath(normalizedFilePath);
      if (
        this.isAbsolutePath(relativeFilePath) ||
        relativeFilePath.startsWith('../')
      ) {
        return false;
      }
    }

    return true;
  }

  private shouldIgnoreOriginalSource(source: string): boolean {
    const normalizedSource = this.normalizeForMatching(source);

    return (
      normalizedSource === 'rstest runtime' ||
      normalizedSource.startsWith('webpack/runtime/') ||
      this.isNodeModulesPath(normalizedSource) ||
      this.isRstestInternalModulePath(normalizedSource)
    );
  }

  private shouldSkipSourceMapEntry(sourceMap?: SourceMapLike): boolean {
    if (!sourceMap?.sources.length) {
      return false;
    }

    return sourceMap.sources.every((source) =>
      this.shouldIgnoreOriginalSource(source),
    );
  }

  private hasInlineSourceMap(code: string): boolean {
    return /[#@]\s*sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,/m.test(
      code,
    );
  }

  private async hasInlineSourceMapOnDisk(filePath: string): Promise<boolean> {
    try {
      return this.hasInlineSourceMap(await fs.readFile(filePath, 'utf-8'));
    } catch (_err) {
      return false;
    }
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

  private parseAst(code: string, outputModule: boolean) {
    return Parser.parse(code, {
      ecmaVersion: 'latest',
      locations: true,
      ranges: true,
      sourceType: outputModule ? 'module' : 'script',
    });
  }

  private async convertWithAst(
    filePath: string,
    entry: inspector.Profiler.ScriptCoverage,
    options?: {
      assetFiles?: Record<string, string>;
      sourceMaps?: Record<string, string>;
      outputModule?: boolean;
    },
  ): Promise<Record<string, FileCoverageData>> {
    const { code, sourceMap } = await this.getTransformedSource(
      filePath,
      options,
    );

    if (this.shouldSkipSourceMapEntry(sourceMap)) {
      return {};
    }

    const ast = this.parseAst(code, options?.outputModule ?? true);

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

  private filterCoverageData(istanbulData: Record<string, FileCoverageData>) {
    for (const key of Object.keys(istanbulData)) {
      const normalizedKey = key.replace(/\\/g, '/');

      // AST remapping can emit original-source entries that differ from the
      // executed script URL. Re-apply the same internal-file guard here so
      // remapped dependency files do not leak into the final map.
      if (this.shouldIgnoreTransformedFile(normalizedKey)) {
        delete istanbulData[key];
        continue;
      }

      const originalTestPath = this.toProjectRelativePath(normalizedKey);

      if (
        this.isExcluded(originalTestPath) ||
        !this.isIncluded(originalTestPath)
      ) {
        delete istanbulData[key];
        continue;
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
    outputModule?: boolean;
  }): Promise<CoverageMap | null> {
    return this.collectImpl(options);
  }

  private async collectImpl(options?: {
    assetFiles?: Record<string, string>;
    sourceMaps?: Record<string, string>;
    outputModule?: boolean;
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

        const sourceMapStr = this.findInDict(options?.sourceMaps, filePath);
        const assetSource = this.findInDict(options?.assetFiles, filePath);
        let hasSourceMap = Boolean(
          sourceMapStr || (assetSource && this.hasInlineSourceMap(assetSource)),
        );

        if (!this.shouldProcessEntry(filePath) && !hasSourceMap) {
          hasSourceMap = await this.hasInlineSourceMapOnDisk(filePath);
          if (!hasSourceMap) return;
        }

        if (!hasSourceMap) {
          const originalTestPath = this.toProjectRelativePath(filePath);
          if (
            this.isExcluded(originalTestPath) ||
            !this.isIncluded(originalTestPath)
          ) {
            hasSourceMap = await this.hasInlineSourceMapOnDisk(filePath);
            if (!hasSourceMap) return;
          }
        }

        try {
          const istanbulData = await this.convertWithAst(
            filePath,
            entry,
            options,
          );

          this.filterCoverageData(istanbulData);
          coverageMap.merge(istanbulData);
        } catch (e) {
          console.error(`Failed to process coverage for ${entry.url}:`, e);
          process.exitCode = 1;
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
          let converter: ReturnType<typeof v8ToIstanbul> | undefined;
          try {
            converter = v8ToIstanbul(file, 0, undefined, () => false);
            await converter.load();
            converter.applyCoverage([
              {
                functionName: '(empty-report)',
                ranges: [{ startOffset: 0, endOffset: 0, count: 0 }],
                isBlockCoverage: true,
              },
            ]);
            const istanbulData = converter.toIstanbul();
            const keys = Object.keys(istanbulData);
            if (keys.length > 0) {
              return istanbulData[keys[0] as string] as FileCoverageData;
            }
          } catch (e) {
            console.error(
              `Can not generate coverage for untested file, file: ${file}, error: ${e}`,
            );
            process.exitCode = 1;
          } finally {
            converter?.destroy();
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
