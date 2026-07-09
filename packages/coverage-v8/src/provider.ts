import fs from 'node:fs/promises';
import inspector from 'node:inspector/promises';
import { dirname, isAbsolute, posix, resolve, win32 } from 'node:path';
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
import { createFastCoverageMap, mapWithConcurrency } from './utils';
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

const COVERAGE_CONVERSION_CONCURRENCY = 4;
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
  sourceMapStr?: string;
  sourceMapUrl?: string;
};

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

  private async loadExternalSourceMap(
    filePath: string,
    code: string,
  ): Promise<{
    sourceMap?: SourceMapLike;
    sourceMapStr?: string;
    sourceMapUrl?: string;
  }> {
    const sourceMapUrl = this.getSourceMapUrl(code);
    if (!sourceMapUrl || this.isInlineSourceMapUrl(sourceMapUrl)) {
      return {};
    }

    try {
      const resolvedSourceMapUrl = resolve(dirname(filePath), sourceMapUrl);
      const sourceMapStr = await fs.readFile(resolvedSourceMapUrl, 'utf-8');

      return {
        sourceMap: {
          names: [],
          ...(JSON.parse(sourceMapStr) as Partial<SourceMapLike>),
        } as SourceMapLike,
        sourceMapStr,
        sourceMapUrl: resolvedSourceMapUrl,
      };
    } catch {
      return {};
    }
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

  private async getTransformedSource(
    filePath: string,
    options?: Pick<CollectOptions, 'assetFiles' | 'sourceMaps'>,
  ): Promise<TransformedSource> {
    const assetSource = this.findInDict(options?.assetFiles, filePath);
    const sourceMapStr = this.findInDict(options?.sourceMaps, filePath);
    const code = assetSource ?? (await fs.readFile(filePath, 'utf-8'));

    if (sourceMapStr) {
      return {
        code,
        sourceMap: {
          names: [],
          ...(JSON.parse(sourceMapStr) as Partial<SourceMapLike>),
        } as SourceMapLike,
        sourceMapStr,
      };
    }

    return {
      code,
      ...(await this.loadExternalSourceMap(filePath, code)),
    };
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
    const { code, sourceMap, sourceMapStr, sourceMapUrl } =
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
      sourceMapStr,
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

  private getConverterCacheKey(
    filePath: string,
    code: string,
    codeHash: number,
    sourceMapStr: string | undefined,
    outputModule: boolean,
    root: string | undefined,
  ): string {
    return [
      this.getAstCacheKey(filePath, code, codeHash, outputModule),
      sourceMapStr?.length ?? 0,
      sourceMapStr ? this.hashString(sourceMapStr) : 0,
      root ?? '',
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

  resolveRawCoverage(payloads: unknown[]): Promise<CoverageMap | null> {
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

    return this.collectRawPayloads(validPayloads);
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
      options: this.pickRawCoverageOptions(filteredEntries, options),
      root: this.root,
    };
  }

  private pickRawCoverageOptions(
    entries: CoverageEntry[],
    options?: CollectOptions,
  ): CollectOptions | undefined {
    if (!options) return undefined;

    const assetFiles: Record<string, string> = {};
    const sourceMaps: Record<string, string> = {};

    for (const entry of entries) {
      const assetSource = this.findInDict(options.assetFiles, entry.filePath);
      if (typeof assetSource === 'string') {
        assetFiles[entry.filePath] = assetSource;
      }

      const sourceMap = this.findInDict(options.sourceMaps, entry.filePath);
      if (typeof sourceMap === 'string') {
        sourceMaps[entry.filePath] = sourceMap;
      }
    }

    return {
      ...(Object.keys(assetFiles).length ? { assetFiles } : {}),
      ...(Object.keys(sourceMaps).length ? { sourceMaps } : {}),
      outputModule: options.outputModule,
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
      COVERAGE_CONVERSION_CONCURRENCY,
      async (entry) => {
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
      },
    );

    return coverageMap;
  }

  private async collectRawPayloads(
    payloads: RawCoveragePayload[],
  ): Promise<CoverageMap | null> {
    const coverageMap = this.createCoverageMap();
    const groups = new Map<string, CoverageEntryGroup>();
    const sourceIdentityIds = new Map<string, number>();

    for (const payload of payloads) {
      for (const entry of payload.entries) {
        const key = this.getRawCoverageGroupKey(
          payload,
          entry,
          sourceIdentityIds,
        );
        this.mergeIntoCoverageEntries(
          groups,
          key,
          entry,
          payload.options,
          payload.root,
        );
      }
    }

    await mapWithConcurrency(
      Array.from(groups.values()),
      COVERAGE_CONVERSION_CONCURRENCY,
      async ({ entries, options, root }) => {
        try {
          const transformedSource = await this.getTransformedSource(
            entries[0]!.filePath,
            options,
          );

          for (const entry of entries) {
            try {
              const istanbulData = await this.convertWithAst(
                entry.filePath,
                entry,
                options,
                transformedSource,
                root,
              );

              this.filterCoverageData(istanbulData, root);
              coverageMap.merge(istanbulData);
            } catch (e) {
              console.error(`Failed to process coverage for ${entry.url}:`, e);
              process.exitCode = 1;
            }
          }
        } catch (e) {
          console.error(
            `Failed to process coverage for ${entries[0]!.url}:`,
            e,
          );
          process.exitCode = 1;
        }
      },
    );

    return coverageMap;
  }

  private getRawCoverageGroupKey(
    payload: RawCoveragePayload,
    entry: CoverageEntry,
    sourceIdentityIds: Map<string, number>,
  ): string {
    const outputModule = payload.options?.outputModule ?? true;
    const assetSource = this.findInDict(
      payload.options?.assetFiles,
      entry.filePath,
    );
    const sourceMap = this.findInDict(
      payload.options?.sourceMaps,
      entry.filePath,
    );

    return [
      payload.root ?? '',
      entry.filePath,
      outputModule ? 'module' : 'script',
      this.getStringIdentity(assetSource, sourceIdentityIds),
      this.getStringIdentity(sourceMap, sourceIdentityIds),
    ].join('\0');
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

    group.entries.push(this.cloneCoverageEntry(entry));
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

  private cloneCoverageEntry(entry: CoverageEntry): CoverageEntry {
    return {
      ...entry,
      functions: entry.functions.map((fn) => ({
        ...fn,
        ranges: fn.ranges.map((range) => ({ ...range })),
      })),
    };
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
