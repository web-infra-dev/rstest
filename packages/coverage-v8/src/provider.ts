import fs from 'node:fs/promises';
import inspector from 'node:inspector/promises';
import { isAbsolute, posix, resolve, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import { Parser } from 'acorn';
import { type CoverageMap, type FileCoverageData } from 'istanbul-lib-coverage';
import type { ReportBase } from 'istanbul-lib-report';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import picomatch from 'picomatch';
import v8ToIstanbul from 'v8-to-istanbul';
import { createFastCoverageMap } from './utils';
import { convertV8CoverageWithAst } from './v8AstConverter';

type SourceMapLike = {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  file?: string;
  sourceRoot?: string;
  sourcesContent?: (string | null)[];
};

type CoverageReporterConstructor = new (
  options: Record<string, unknown>,
) => ReportBase;

const MAX_PARSED_AST_CACHE_SIZE = 50;
const INLINE_SOURCE_MAP_PATTERN =
  /[#@]\s*sourceMappingURL\s*=\s*data:application\/json(?:;[^'",\s]*)*,/i;
const parsedAstCache = new Map<string, ReturnType<typeof Parser.parse>>();

type CoverageEntry = inspector.Profiler.ScriptCoverage & {
  filePath: string;
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
  private diskInlineSourceMapCache = new Map<string, Promise<boolean>>();

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

  private shouldKeepOriginalSource(filePath: string): boolean {
    const normalizedKey = filePath.replace(/\\/g, '/');

    if (this.shouldIgnoreTransformedFile(normalizedKey)) {
      return false;
    }

    const originalTestPath = this.toProjectRelativePath(normalizedKey);
    return (
      !this.isExcluded(originalTestPath) && this.isIncluded(originalTestPath)
    );
  }

  private hasInlineSourceMap(code: string): boolean {
    return INLINE_SOURCE_MAP_PATTERN.test(code);
  }

  private async hasInlineSourceMapOnDisk(filePath: string): Promise<boolean> {
    let cached = this.diskInlineSourceMapCache.get(filePath);
    if (!cached) {
      cached = fs
        .readFile(filePath, 'utf-8')
        .then((code) => this.hasInlineSourceMap(code))
        .catch(() => false);
      this.diskInlineSourceMapCache.set(filePath, cached);
    }

    return cached;
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
    sourceMapStr?: string;
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
      sourceMapStr,
    };
  }

  private parseAst(code: string, outputModule: boolean, cacheKey: string) {
    const cachedAst = parsedAstCache.get(cacheKey);
    if (cachedAst) {
      return cachedAst;
    }

    const ast = Parser.parse(code, {
      ecmaVersion: 'latest',
      locations: true,
      ranges: true,
      sourceType: outputModule ? 'module' : 'script',
    });

    parsedAstCache.set(cacheKey, ast);

    if (parsedAstCache.size > MAX_PARSED_AST_CACHE_SIZE) {
      const firstKey = parsedAstCache.keys().next().value;
      if (firstKey) {
        parsedAstCache.delete(firstKey);
      }
    }

    return ast;
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
    const { code, sourceMap, sourceMapStr } = await this.getTransformedSource(
      filePath,
      options,
    );

    if (this.shouldSkipSourceMapEntry(sourceMap)) {
      return {};
    }

    const outputModule = options?.outputModule ?? true;
    const codeHash = this.hashString(code);
    const astCacheKey = this.getAstCacheKey(
      filePath,
      code,
      codeHash,
      outputModule,
    );
    const converterCacheKey = this.getConverterCacheKey(
      filePath,
      code,
      codeHash,
      sourceMapStr,
      outputModule,
    );
    const ast = this.parseAst(code, outputModule, astCacheKey);

    return convertV8CoverageWithAst({
      ast,
      cacheKey: converterCacheKey,
      code,
      sourceFilter: (sourcePath) => this.shouldKeepOriginalSource(sourcePath),
      sourceMap,
      coverage: {
        url: entry.url,
        functions: entry.functions,
      },
    });
  }

  private getConverterCacheKey(
    filePath: string,
    code: string,
    codeHash: number,
    sourceMapStr: string | undefined,
    outputModule: boolean,
  ): string {
    return [
      this.getAstCacheKey(filePath, code, codeHash, outputModule),
      sourceMapStr?.length ?? 0,
      sourceMapStr ? this.hashString(sourceMapStr) : 0,
      this.root ?? '',
      this.options.allowExternal ? 'external' : 'root-only',
      this.options.include?.join('\n') ?? '',
      this.options.exclude.join('\n'),
    ].join('\0');
  }

  private getAstCacheKey(
    filePath: string,
    code: string,
    codeHash: number,
    outputModule: boolean,
  ): string {
    return [
      filePath,
      outputModule ? 'module' : 'script',
      code.length,
      codeHash,
    ].join('\0');
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
      hash = Math.imul(31, hash) + value.charCodeAt(index);
    }
    return hash >>> 0;
  }

  private filterCoverageData(istanbulData: Record<string, FileCoverageData>) {
    for (const key of Object.keys(istanbulData)) {
      if (!this.shouldKeepOriginalSource(key)) {
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

  private async takeRawCoverage(): Promise<CoverageEntry[]> {
    if (!this.session) return [];

    const coverage = await this.session.post('Profiler.takePreciseCoverage');
    const entries: CoverageEntry[] = [];

    for (const entry of coverage.result) {
      if (!entry.url.startsWith('file://')) continue;

      const filePath = fileURLToPath(entry.url).replace(/\\/g, '/');
      if (!this.isMatch(filePath)) continue;

      entries.push({ ...entry, filePath });
    }

    return entries;
  }

  private async filterRawCoverageEntries(
    entries: CoverageEntry[],
    options?: {
      assetFiles?: Record<string, string>;
      sourceMaps?: Record<string, string>;
    },
  ): Promise<CoverageEntry[]> {
    const filtered: CoverageEntry[] = [];

    for (const entry of entries) {
      if (await this.shouldKeepRawCoverageEntry(entry, options)) {
        filtered.push(entry);
      }
    }

    return filtered;
  }

  private async shouldKeepRawCoverageEntry(
    entry: CoverageEntry,
    options?: {
      assetFiles?: Record<string, string>;
      sourceMaps?: Record<string, string>;
    },
  ): Promise<boolean> {
    const { filePath } = entry;
    const sourceMapStr = this.findInDict(options?.sourceMaps, filePath);
    const assetSource = this.findInDict(options?.assetFiles, filePath);

    if (sourceMapStr || (assetSource && this.hasInlineSourceMap(assetSource))) {
      return true;
    }

    if (
      this.shouldProcessEntry(filePath) &&
      this.shouldKeepOriginalSource(filePath)
    ) {
      return true;
    }

    return assetSource === undefined && this.hasInlineSourceMapOnDisk(filePath);
  }

  private async collectImpl(options?: {
    assetFiles?: Record<string, string>;
    sourceMaps?: Record<string, string>;
    outputModule?: boolean;
  }): Promise<CoverageMap | null> {
    if (!this.session) return null;

    let entries: CoverageEntry[];
    try {
      entries = await this.takeRawCoverage();
    } finally {
      try {
        await this.session.post('Profiler.stopPreciseCoverage');
        await this.session.post('Profiler.disable');
      } catch (_err) {
        // Ignore teardown errors to prevent masking original errors
      }
    }

    const filteredEntries = await this.filterRawCoverageEntries(
      entries,
      options,
    );
    const coverageMap = this.createCoverageMap();

    await Promise.all(
      filteredEntries.map(async (entry) => {
        try {
          const istanbulData = await this.convertWithAst(
            entry.filePath,
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
    return createFastCoverageMap();
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

  async generateReports(coverageMap: CoverageMap): Promise<void> {
    const context = createContext({
      dir: this.options.reportsDirectory,
      coverageMap: coverageMap,
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

  private isRequireEsmError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    return error.code === 'ERR_REQUIRE_ESM';
  }

  private toImportSpecifier(reporterName: string): string {
    if (isAbsolute(reporterName)) {
      return pathToFileURL(reporterName).toString();
    }

    return reporterName;
  }
  cleanup(): void {
    this.session?.disconnect();
    this.session = null;
  }
}
