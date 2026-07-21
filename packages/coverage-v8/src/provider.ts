import fs from 'node:fs/promises';
import inspector from 'node:inspector/promises';
import { dirname, isAbsolute, posix, resolve, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
  RawCoverageResolveOptions,
} from '@rstest/core';
import { Parser } from 'acorn';
import { type CoverageMap, type FileCoverageData } from 'istanbul-lib-coverage';
import type { ReportBase } from 'istanbul-lib-report';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import picomatch from 'picomatch';
import { createFastCoverageMap, mapWithConcurrency } from './utils';
import {
  applyV8CoverageWithAst,
  convertV8CoverageWithAst,
  resolveSourceMapFilenames,
} from './v8AstConverter';

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

const COVERAGE_PROCESSING_CONCURRENCY = 4;
const SOURCE_MAP_INNER_PATTERN =
  /\s*[#@]\s*sourceMappingURL\s*=\s*([^\s'"]*)\s*/;
const SOURCE_MAP_URL_PATTERN = new RegExp(
  `(?:/\\*(?:\\s*\\r?\\n(?://)?)?${SOURCE_MAP_INNER_PATTERN.source}\\s*\\*/|//${SOURCE_MAP_INNER_PATTERN.source})\\s*`,
);

type CoverageEntry = inspector.Profiler.ScriptCoverage & {
  filePath: string;
};

type CollectOptions = NonNullable<
  Parameters<RstestCoverageProvider['collect']>[0]
>;

type TransformedSource = {
  code: string;
  sourceMap?: SourceMapLike;
  sourceMapKey?: string;
  sourceMapUrl?: string;
};
type ExternalSourceMap = Omit<TransformedSource, 'code'>;

type RawCoveragePayload = {
  entries: CoverageEntry[];
  options?: CollectOptions;
  root?: string;
};

type CoverageEntryGroup = {
  entries: CoverageEntry[];
  options?: CollectOptions;
  root?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isStringDict = (value: unknown): value is Record<string, string> =>
  isRecord(value) &&
  Object.values(value).every((item) => typeof item === 'string');

const findNonStringDictEntry = (
  value: unknown,
): { key: string; value: unknown } | undefined => {
  if (!isRecord(value)) return undefined;

  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      return { key, value: item };
    }
  }

  return undefined;
};

const describeValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const describeMalformedRawCoveragePayload = (
  payload: unknown,
  index: number,
): string => {
  const prefix = `Failed to resolve malformed raw V8 coverage payload at index ${index}`;

  if (!isRecord(payload)) {
    return `${prefix}: expected an object, received ${describeValue(payload)}.`;
  }

  if (!Array.isArray(payload.entries)) {
    return `${prefix}: expected "entries" to be an array, received ${describeValue(
      payload.entries,
    )}. Keys: ${Object.keys(payload).join(', ') || '<none>'}.`;
  }

  const invalidEntryIndex = payload.entries.findIndex(
    (entry) => !isCoverageEntry(entry),
  );
  if (invalidEntryIndex !== -1) {
    const entry = payload.entries[invalidEntryIndex];
    return `${prefix}: invalid entry at entries[${invalidEntryIndex}] (${describeValue(
      entry,
    )}). Entries: ${payload.entries.length}.`;
  }

  if (payload.options !== undefined && !isRecord(payload.options)) {
    return `${prefix}: expected "options" to be an object, received ${describeValue(
      payload.options,
    )}. Entries: ${payload.entries.length}.`;
  }

  if (isRecord(payload.options)) {
    if (
      payload.options.assetFiles !== undefined &&
      !isRecord(payload.options.assetFiles)
    ) {
      return `${prefix}: expected options.assetFiles to be an object, received ${describeValue(
        payload.options.assetFiles,
      )}. Entries: ${payload.entries.length}.`;
    }

    if (
      payload.options.sourceMaps !== undefined &&
      !isRecord(payload.options.sourceMaps)
    ) {
      return `${prefix}: expected options.sourceMaps to be an object, received ${describeValue(
        payload.options.sourceMaps,
      )}. Entries: ${payload.entries.length}.`;
    }

    const invalidAssetFile = findNonStringDictEntry(payload.options.assetFiles);
    if (invalidAssetFile) {
      return `${prefix}: expected options.assetFiles[${JSON.stringify(
        invalidAssetFile.key,
      )}] to be a string, received ${describeValue(
        invalidAssetFile.value,
      )}. Entries: ${payload.entries.length}.`;
    }

    const invalidSourceMap = findNonStringDictEntry(payload.options.sourceMaps);
    if (invalidSourceMap) {
      return `${prefix}: expected options.sourceMaps[${JSON.stringify(
        invalidSourceMap.key,
      )}] to be a string, received ${describeValue(
        invalidSourceMap.value,
      )}. Entries: ${payload.entries.length}.`;
    }

    if (
      payload.options.outputModule !== undefined &&
      typeof payload.options.outputModule !== 'boolean'
    ) {
      return `${prefix}: expected options.outputModule to be a boolean, received ${describeValue(
        payload.options.outputModule,
      )}. Entries: ${payload.entries.length}.`;
    }
  }

  if (payload.root !== undefined && typeof payload.root !== 'string') {
    return `${prefix}: expected "root" to be a string, received ${describeValue(
      payload.root,
    )}. Entries: ${payload.entries.length}.`;
  }

  return `${prefix}: unknown shape mismatch. Entries: ${payload.entries.length}.`;
};

const isCollectOptions = (value: unknown): value is CollectOptions =>
  isRecord(value) &&
  (value.assetFiles === undefined || isStringDict(value.assetFiles)) &&
  (value.sourceMaps === undefined || isStringDict(value.sourceMaps)) &&
  (value.outputModule === undefined || typeof value.outputModule === 'boolean');

const isCoverageRange = (
  value: unknown,
): value is inspector.Profiler.CoverageRange =>
  isRecord(value) &&
  typeof value.startOffset === 'number' &&
  typeof value.endOffset === 'number' &&
  typeof value.count === 'number';

const isFunctionCoverage = (
  value: unknown,
): value is inspector.Profiler.FunctionCoverage =>
  isRecord(value) &&
  typeof value.functionName === 'string' &&
  typeof value.isBlockCoverage === 'boolean' &&
  Array.isArray(value.ranges) &&
  value.ranges.every(isCoverageRange);

const isCoverageEntry = (value: unknown): value is CoverageEntry =>
  isRecord(value) &&
  typeof value.url === 'string' &&
  typeof value.scriptId === 'string' &&
  typeof value.filePath === 'string' &&
  Array.isArray(value.functions) &&
  value.functions.every(isFunctionCoverage);

const isRawCoveragePayload = (value: unknown): value is RawCoveragePayload =>
  isRecord(value) &&
  Array.isArray(value.entries) &&
  value.entries.every(isCoverageEntry) &&
  (value.options === undefined || isCollectOptions(value.options)) &&
  (value.root === undefined || typeof value.root === 'string');

export class CoverageProvider implements RstestCoverageProvider {
  private session: inspector.Session | null = null;
  private isMatch: (filePath: string) => boolean;
  private isIncluded: (filePath: string) => boolean;
  private isExcluded: (filePath: string) => boolean;
  private dictLookupCache = new WeakMap<
    Record<string, string>,
    Map<string, string>
  >();
  private diskSourceMapCache = new Map<string, Promise<boolean>>();

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

  private toProjectRelativePath(filePath: string, root = this.root): string {
    const normalizedFilePath = this.normalizeSlashes(filePath);

    if (!root || !this.isAbsolutePath(normalizedFilePath)) {
      return normalizedFilePath;
    }

    const normalizedRoot = this.normalizeSlashes(root);

    if (
      this.normalizeForMatching(normalizedFilePath) ===
      this.normalizeForMatching(normalizedRoot)
    ) {
      return '';
    }

    if (
      win32.isAbsolute(normalizedFilePath) ||
      win32.isAbsolute(normalizedRoot)
    ) {
      return win32
        .relative(normalizedRoot, normalizedFilePath)
        .replace(/\\/g, '/');
    }

    return posix.relative(normalizedRoot, normalizedFilePath);
  }

  private findInDict(
    dict: Record<string, string> | undefined,
    filePath: string,
  ): string | undefined {
    if (!dict) return undefined;
    if (dict[filePath] !== undefined) return dict[filePath];

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
    if (directMatch !== undefined) return directMatch;

    if (filePath.startsWith('/private/')) {
      const privateMatch = lookup.get(filePath.slice('/private'.length));
      if (privateMatch !== undefined) return privateMatch;
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

  private shouldProcessEntry(filePath: string, root = this.root): boolean {
    const normalizedFilePath = this.normalizeForMatching(filePath);
    const normalizedRoot = root ? this.normalizeForMatching(root) : undefined;

    if (this.shouldIgnoreTransformedFile(normalizedFilePath)) {
      return false;
    }

    if (!this.options.allowExternal && normalizedRoot) {
      const relativeFilePath = this.toProjectRelativePath(
        normalizedFilePath,
        normalizedRoot,
      );
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

  private shouldKeepOriginalSource(
    filePath: string,
    root = this.root,
  ): boolean {
    const normalizedKey = filePath.replace(/\\/g, '/');

    if (this.shouldIgnoreTransformedFile(normalizedKey)) {
      return false;
    }

    const originalTestPath = this.toProjectRelativePath(normalizedKey, root);
    return (
      !this.isExcluded(originalTestPath) && this.isIncluded(originalTestPath)
    );
  }

  private hasInlineSourceMap(code: string): boolean {
    const sourceMapUrl = this.getSourceMapUrl(code);
    return (
      sourceMapUrl !== undefined && this.isInlineSourceMapUrl(sourceMapUrl)
    );
  }

  private hasExternalSourceMap(code: string): boolean {
    const sourceMapUrl = this.getSourceMapUrl(code);
    return (
      sourceMapUrl !== undefined && !this.isInlineSourceMapUrl(sourceMapUrl)
    );
  }

  private getSourceMapUrl(code: string): string | undefined {
    let searchIndex = code.lastIndexOf('sourceMappingURL');

    while (searchIndex !== -1) {
      const lineStart = code.lastIndexOf('\n', searchIndex);
      const lineEnd = code.indexOf('\n', searchIndex);
      const line = code.slice(
        lineStart + 1,
        lineEnd === -1 ? code.length : lineEnd,
      );
      const match = line.match(SOURCE_MAP_URL_PATTERN);

      if (match) {
        const sourceMapUrl = match[1] || match[2] || '';
        return sourceMapUrl ? decodeURI(sourceMapUrl) : undefined;
      }

      searchIndex = code.lastIndexOf('sourceMappingURL', lineStart - 1);
    }

    return undefined;
  }

  private isInlineSourceMapUrl(url: string): boolean {
    return url.startsWith('data:');
  }

  private loadExternalSourceMap(
    filePath: string,
    code: string,
  ): ExternalSourceMap | Promise<ExternalSourceMap> {
    const sourceMapUrl = this.getSourceMapUrl(code);
    if (!sourceMapUrl || this.isInlineSourceMapUrl(sourceMapUrl)) {
      return {};
    }

    const resolvedSourceMapUrl = resolve(dirname(filePath), sourceMapUrl);
    return fs
      .readFile(resolvedSourceMapUrl, 'utf-8')
      .then((sourceMapStr) => ({
        sourceMap: {
          names: [],
          ...(JSON.parse(sourceMapStr) as Partial<SourceMapLike>),
        } as SourceMapLike,
        sourceMapKey: this.getSourceMapKey(sourceMapStr),
        sourceMapUrl: resolvedSourceMapUrl,
      }))
      .catch(() => ({}));
  }

  private async hasSourceMapOnDisk(filePath: string): Promise<boolean> {
    let cached = this.diskSourceMapCache.get(filePath);
    if (!cached) {
      cached = fs
        .readFile(filePath, 'utf-8')
        .then((code) => this.getSourceMapUrl(code) !== undefined)
        .catch(() => false);
      this.diskSourceMapCache.set(filePath, cached);
    }

    return cached;
  }

  private getTransformedSource(
    filePath: string,
    options?: Pick<CollectOptions, 'assetFiles' | 'sourceMaps'>,
    parsedSourceMap?: SourceMapLike,
  ): TransformedSource | Promise<TransformedSource> {
    const assetSource = this.findInDict(options?.assetFiles, filePath);
    const sourceMapStr = this.findInDict(options?.sourceMaps, filePath);
    const transform = (
      code: string,
    ): TransformedSource | Promise<TransformedSource> => {
      if (sourceMapStr) {
        return {
          code,
          sourceMap:
            parsedSourceMap ??
            ({
              names: [],
              ...(JSON.parse(sourceMapStr) as Partial<SourceMapLike>),
            } as SourceMapLike),
          sourceMapKey: this.getSourceMapKey(sourceMapStr),
        };
      }

      const externalSourceMap = this.loadExternalSourceMap(filePath, code);
      return externalSourceMap instanceof Promise
        ? externalSourceMap.then((result) => ({ code, ...result }))
        : { code, ...externalSourceMap };
    };

    return assetSource === undefined
      ? fs.readFile(filePath, 'utf-8').then(transform)
      : transform(assetSource);
  }

  private parseAst(code: string, outputModule: boolean) {
    return Parser.parse(code, {
      ecmaVersion: 'latest',
      sourceType: outputModule ? 'module' : 'script',
    });
  }

  private async convertWithAst(
    filePath: string,
    entry: inspector.Profiler.ScriptCoverage,
    options?: CollectOptions,
    transformedSource?: TransformedSource,
    root = this.root,
  ): Promise<Record<string, FileCoverageData>> {
    const { code, sourceMap, sourceMapKey, sourceMapUrl } =
      transformedSource ?? (await this.getTransformedSource(filePath, options));

    if (this.shouldSkipSourceMapEntry(sourceMap)) {
      return {};
    }

    const outputModule = options?.outputModule ?? true;
    const codeHash = this.hashString(code);
    const converterCacheKey = this.getConverterCacheKey(
      filePath,
      code,
      codeHash,
      sourceMapKey,
      outputModule,
      root,
    );

    return convertV8CoverageWithAst({
      ast: () => this.parseAst(code, outputModule),
      cacheKey: converterCacheKey,
      code,
      sourceFilter: (sourcePath) =>
        this.shouldKeepOriginalSource(sourcePath, root),
      sourceMap,
      sourceMapUrl,
      coverage: {
        url: entry.url,
        functions: entry.functions,
      },
    });
  }

  private async applyWithAst(
    coverageMap: CoverageMap,
    filePath: string,
    entry: inspector.Profiler.ScriptCoverage,
    options?: CollectOptions,
    transformedSource?: TransformedSource,
    root = this.root,
  ): Promise<void> {
    if (this.convertWithAst !== CoverageProvider.prototype.convertWithAst) {
      const istanbulData = await this.convertWithAst(
        filePath,
        entry,
        options,
        transformedSource,
        root,
      );
      this.filterCoverageData(istanbulData, root);
      coverageMap.merge(istanbulData);
      return;
    }

    const { code, sourceMap, sourceMapKey, sourceMapUrl } =
      transformedSource ?? (await this.getTransformedSource(filePath, options));

    if (this.shouldSkipSourceMapEntry(sourceMap)) {
      return;
    }

    const outputModule = options?.outputModule ?? true;
    const codeHash = this.hashString(code);
    const converterCacheKey = this.getConverterCacheKey(
      filePath,
      code,
      codeHash,
      sourceMapKey,
      outputModule,
      root,
    );

    await applyV8CoverageWithAst({
      coverageMap,
      ast: () => this.parseAst(code, outputModule),
      cacheKey: converterCacheKey,
      code,
      sourceFilter: (sourcePath) =>
        this.shouldKeepOriginalSource(sourcePath, root),
      sourceMap,
      sourceMapUrl,
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
    sourceMapKey: string | undefined,
    outputModule: boolean,
    root: string | undefined,
  ): string {
    return [
      this.getAstCacheKey(filePath, code, codeHash, outputModule),
      sourceMapKey ?? '',
      root ?? '',
      this.options.allowExternal ? 'external' : 'root-only',
      this.options.include?.join('\n') ?? '',
      this.options.exclude.join('\n'),
    ].join('\0');
  }

  private getSourceMapKey(sourceMapStr: string): string {
    return `${sourceMapStr.length}:${this.hashString(sourceMapStr)}`;
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

  private filterCoverageData(
    istanbulData: Record<string, FileCoverageData>,
    root = this.root,
  ) {
    for (const key of Object.keys(istanbulData)) {
      if (!this.shouldKeepOriginalSource(key, root)) {
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

  collect(options?: CollectOptions): Promise<CoverageMap | null> {
    return this.collectImpl(options);
  }

  resolveRawCoverage(
    payloads: unknown[],
    options?: RawCoverageResolveOptions,
  ): Promise<CoverageMap | null> {
    const validPayloads: RawCoveragePayload[] = [];

    for (const [index, payload] of payloads.entries()) {
      if (isRawCoveragePayload(payload)) {
        validPayloads.push(payload);
      } else {
        console.error(describeMalformedRawCoveragePayload(payload, index));
        process.exitCode = 1;
      }
    }

    if (!validPayloads.length) {
      return Promise.resolve(null);
    }

    return this.collectRawPayloads(
      validPayloads,
      options?.loadAssetFiles,
      options?.loadSourceMaps,
    );
  }

  async collectRaw(
    options?: CollectOptions,
  ): Promise<RawCoveragePayload | null> {
    if (!this.session) return null;

    let entries: CoverageEntry[];
    try {
      entries = await this.takeRawCoverage();
    } finally {
      await this.stopCoverage();
    }

    const filteredEntries = await this.filterRawCoverageEntries(
      entries,
      options,
    );

    return {
      entries: filteredEntries,
      options: options ? { outputModule: options.outputModule } : undefined,
      root: this.root,
    };
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
    options?: Pick<CollectOptions, 'assetFiles' | 'sourceMaps'>,
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
    options?: Pick<CollectOptions, 'assetFiles' | 'sourceMaps'>,
  ): Promise<boolean> {
    const { filePath } = entry;
    const sourceMapStr = this.findInDict(options?.sourceMaps, filePath);
    const assetSource = this.findInDict(options?.assetFiles, filePath);

    if (
      sourceMapStr ||
      (assetSource && this.hasExternalSourceMap(assetSource))
    ) {
      return true;
    }

    if (assetSource && this.hasInlineSourceMap(assetSource)) {
      return true;
    }

    if (
      this.shouldProcessEntry(filePath) &&
      this.shouldKeepOriginalSource(filePath)
    ) {
      return true;
    }

    return assetSource === undefined && this.hasSourceMapOnDisk(filePath);
  }

  private async collectImpl(
    options?: CollectOptions,
  ): Promise<CoverageMap | null> {
    if (!this.session) return null;

    let entries: CoverageEntry[];
    try {
      entries = await this.takeRawCoverage();
    } finally {
      await this.stopCoverage();
    }

    const filteredEntries = await this.filterRawCoverageEntries(
      entries,
      options,
    );
    const coverageMap = this.createCoverageMap();

    await mapWithConcurrency(
      filteredEntries,
      COVERAGE_PROCESSING_CONCURRENCY,
      async (entry) => {
        try {
          await this.applyWithAst(coverageMap, entry.filePath, entry, options);
        } catch (e) {
          console.error(`Failed to process coverage for ${entry.url}:`, e);
          process.exitCode = 1;
        }
      },
    );

    return coverageMap;
  }

  private async collectRawPayloads(
    payloads: RawCoveragePayload[],
    loadAssetFiles?: RawCoverageResolveOptions['loadAssetFiles'],
    loadSourceMaps?: RawCoverageResolveOptions['loadSourceMaps'],
  ): Promise<CoverageMap | null> {
    const coverageMap = this.createCoverageMap();
    const entriesByFilePath = new Map<
      string,
      {
        entry: CoverageEntry;
        payload: RawCoveragePayload;
      }[]
    >();

    for (const payload of payloads) {
      for (const entry of payload.entries) {
        const entries = entriesByFilePath.get(entry.filePath) ?? [];
        entries.push({ entry, payload });
        entriesByFilePath.set(entry.filePath, entries);
      }
      payload.entries.length = 0;
    }

    const fileEntries = Array.from(entriesByFilePath.entries());
    entriesByFilePath.clear();

    await mapWithConcurrency(
      fileEntries,
      COVERAGE_PROCESSING_CONCURRENCY,
      async ([filePath, rawEntries]) => {
        let loadedSourceMaps = await loadSourceMaps?.([filePath]);
        const parsedSourceMaps = new Map<string, SourceMapLike>();
        const retainedEntries: {
          entry: CoverageEntry;
          payload: RawCoveragePayload;
        }[] = [];

        for (const { entry, payload } of rawEntries) {
          const sourceMapStr =
            this.findInDict(payload.options?.sourceMaps, filePath) ??
            this.findInDict(loadedSourceMaps, filePath);

          if (sourceMapStr) {
            try {
              const sourceMapKey = this.getSourceMapKey(sourceMapStr);
              let sourceMap = parsedSourceMaps.get(sourceMapKey);
              if (!sourceMap) {
                sourceMap = {
                  names: [],
                  ...(JSON.parse(sourceMapStr) as Partial<SourceMapLike>),
                } as SourceMapLike;
                parsedSourceMaps.set(sourceMapKey, sourceMap);
              }

              if (
                !this.shouldKeepSourceMapEntry(
                  filePath,
                  sourceMap,
                  payload.root,
                )
              ) {
                continue;
              }
            } catch {
              // Preserve per-entry conversion errors for malformed source maps.
            }
          }

          retainedEntries.push({ entry, payload });
        }
        rawEntries.length = 0;

        if (!retainedEntries.length) {
          parsedSourceMaps.clear();
          return;
        }

        let loadedAssetFiles = await loadAssetFiles?.([filePath]);
        const loadedOptions = {
          assetFiles: loadedAssetFiles,
          sourceMaps: loadedSourceMaps,
        };
        const groups = new Map<string, CoverageEntryGroup>();
        const sourceIdentityIds = new Map<string, number>();

        for (const { entry, payload } of retainedEntries) {
          const options = this.resolveRawCoverageEntryOptions(
            entry,
            payload.options,
            loadedOptions,
          );
          const key = this.getRawCoverageGroupKey(
            payload,
            entry,
            sourceIdentityIds,
            options,
          );
          this.mergeIntoCoverageEntries(
            groups,
            key,
            entry,
            options,
            payload.root,
          );
        }
        retainedEntries.length = 0;
        sourceIdentityIds.clear();
        loadedOptions.assetFiles = undefined;
        loadedOptions.sourceMaps = undefined;
        loadedAssetFiles = undefined;
        loadedSourceMaps = undefined;

        for (const { entries, options, root } of groups.values()) {
          try {
            const sourceMapStr = this.findInDict(options?.sourceMaps, filePath);
            const transformedSourceResult = this.getTransformedSource(
              filePath,
              options,
              sourceMapStr
                ? parsedSourceMaps.get(this.getSourceMapKey(sourceMapStr))
                : undefined,
            );
            const transformedSource =
              transformedSourceResult instanceof Promise
                ? await transformedSourceResult
                : transformedSourceResult;
            const usesCustomConverter =
              this.convertWithAst !== CoverageProvider.prototype.convertWithAst;
            let conversionOptions = options;
            if (options && !usesCustomConverter) {
              conversionOptions = { outputModule: options.outputModule };
              options.assetFiles = undefined;
              options.sourceMaps = undefined;
            }

            for (const entry of entries) {
              try {
                await this.applyWithAst(
                  coverageMap,
                  filePath,
                  entry,
                  conversionOptions,
                  transformedSource,
                  root,
                );
              } catch (e) {
                console.error(
                  `Failed to process coverage for ${entry.url}:`,
                  e,
                );
                process.exitCode = 1;
              }
            }
          } catch (e) {
            console.error(
              `Failed to process coverage for ${entries[0]!.url}:`,
              e,
            );
            process.exitCode = 1;
          } finally {
            entries.length = 0;
          }
        }

        groups.clear();
        parsedSourceMaps.clear();
      },
    );
    fileEntries.length = 0;

    return coverageMap;
  }

  private shouldKeepSourceMapEntry(
    filePath: string,
    sourceMap: SourceMapLike,
    root?: string,
  ): boolean {
    if (!sourceMap.sources.length) return true;

    return resolveSourceMapFilenames(filePath, sourceMap).some((source) =>
      this.shouldKeepOriginalSource(source, root),
    );
  }

  private getRawCoverageGroupKey(
    payload: RawCoveragePayload,
    entry: CoverageEntry,
    sourceIdentityIds: Map<string, number>,
    options?: CollectOptions,
  ): string {
    const outputModule = options?.outputModule ?? true;
    const assetSource = this.findInDict(options?.assetFiles, entry.filePath);
    const sourceMap = this.findInDict(options?.sourceMaps, entry.filePath);

    return [
      payload.root ?? '',
      entry.filePath,
      outputModule ? 'module' : 'script',
      this.getStringIdentity(assetSource, sourceIdentityIds),
      this.getStringIdentity(sourceMap, sourceIdentityIds),
    ].join('\0');
  }

  private resolveRawCoverageEntryOptions(
    entry: CoverageEntry,
    payloadOptions?: CollectOptions,
    loadedOptions?: Pick<CollectOptions, 'assetFiles' | 'sourceMaps'>,
  ): CollectOptions {
    const assetSource =
      this.findInDict(payloadOptions?.assetFiles, entry.filePath) ??
      this.findInDict(loadedOptions?.assetFiles, entry.filePath);
    const sourceMap =
      this.findInDict(payloadOptions?.sourceMaps, entry.filePath) ??
      this.findInDict(loadedOptions?.sourceMaps, entry.filePath);

    return {
      ...(typeof assetSource === 'string'
        ? { assetFiles: { [entry.filePath]: assetSource } }
        : {}),
      ...(typeof sourceMap === 'string'
        ? { sourceMaps: { [entry.filePath]: sourceMap } }
        : {}),
      outputModule: payloadOptions?.outputModule,
    };
  }

  private getStringIdentity(
    value: string | undefined,
    sourceIdentityIds: Map<string, number>,
  ): string {
    if (value === undefined) return 'missing';

    let id = sourceIdentityIds.get(value);
    if (id === undefined) {
      id = sourceIdentityIds.size;
      sourceIdentityIds.set(value, id);
    }

    return String(id);
  }

  private async stopCoverage(): Promise<void> {
    if (!this.session) return;

    try {
      await this.session.post('Profiler.stopPreciseCoverage');
      await this.session.post('Profiler.disable');
    } catch (_err) {
      // Ignore teardown errors to prevent masking original errors
    }
  }

  private mergeIntoCoverageEntries(
    groups: Map<string, CoverageEntryGroup>,
    key: string,
    entry: CoverageEntry,
    options?: CollectOptions,
    root?: string,
  ): void {
    let group = groups.get(key);
    if (!group) {
      group = { entries: [], options, root };
      groups.set(key, group);
    } else if (options) {
      group.options = {
        assetFiles: { ...group.options?.assetFiles, ...options.assetFiles },
        sourceMaps: { ...group.options?.sourceMaps, ...options.sourceMaps },
        outputModule: group.options?.outputModule ?? options.outputModule,
      };
    }

    for (const target of group.entries) {
      if (this.tryMergeCoverageEntry(target, entry)) {
        return;
      }
    }

    group.entries.push(entry);
  }

  private tryMergeCoverageEntry(
    target: CoverageEntry,
    incoming: CoverageEntry,
  ): boolean {
    if (target.functions.length !== incoming.functions.length) {
      return false;
    }

    for (
      let functionIndex = 0;
      functionIndex < target.functions.length;
      functionIndex++
    ) {
      const targetFunction = target.functions[functionIndex]!;
      const incomingFunction = incoming.functions[functionIndex]!;
      if (
        targetFunction.functionName !== incomingFunction.functionName ||
        targetFunction.isBlockCoverage !== incomingFunction.isBlockCoverage ||
        targetFunction.ranges.length !== incomingFunction.ranges.length
      ) {
        return false;
      }

      for (
        let rangeIndex = 0;
        rangeIndex < targetFunction.ranges.length;
        rangeIndex++
      ) {
        const targetRange = targetFunction.ranges[rangeIndex]!;
        const incomingRange = incomingFunction.ranges[rangeIndex]!;
        if (
          targetRange.startOffset !== incomingRange.startOffset ||
          targetRange.endOffset !== incomingRange.endOffset
        ) {
          return false;
        }
      }
    }

    for (
      let functionIndex = 0;
      functionIndex < target.functions.length;
      functionIndex++
    ) {
      const targetFunction = target.functions[functionIndex]!;
      const incomingFunction = incoming.functions[functionIndex]!;
      for (
        let rangeIndex = 0;
        rangeIndex < targetFunction.ranges.length;
        rangeIndex++
      ) {
        targetFunction.ranges[rangeIndex]!.count +=
          incomingFunction.ranges[rangeIndex]!.count;
      }
    }

    return true;
  }

  createCoverageMap(): CoverageMap {
    return createFastCoverageMap();
  }

  async generateCoverageForUntestedFiles({
    environmentName,
    files,
  }: {
    environmentName: string;
    files: string[];
  }): Promise<FileCoverageData[]> {
    const { transformCoverage } = await import('./plugin');
    const results = await mapWithConcurrency(
      files,
      COVERAGE_PROCESSING_CONCURRENCY,
      async (file) => {
        try {
          const source = await fs.readFile(file, 'utf-8');
          const { code, map: sourceMapStr } = await transformCoverage(
            environmentName,
            source,
            file,
          );
          const sourceMap = sourceMapStr
            ? ({
                names: [],
                ...(JSON.parse(sourceMapStr) as Partial<SourceMapLike>),
              } as SourceMapLike)
            : undefined;

          const istanbulData = await this.convertWithAst(
            file,
            {
              url: pathToFileURL(file).href,
              scriptId: '',
              functions: [],
            },
            { outputModule: true },
            {
              code,
              sourceMap,
              sourceMapKey: sourceMapStr
                ? this.getSourceMapKey(sourceMapStr)
                : undefined,
            },
          );
          return Object.values(istanbulData);
        } catch (e) {
          console.error(
            `Can not generate coverage for untested file, file: ${file}, error: ${e}`,
          );
          process.exitCode = 1;
          return [];
        }
      },
    );

    return results.flat();
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
