import { TraceMap } from '@jridgewell/trace-mapping';
import { resolve } from 'pathe';
import type {
  BrowserProviderPage,
  BrowserV8CoverageCollector,
} from './providers';
import {
  loadSourceMapForSource,
  normalizeJavaScriptUrl,
  resolveInlineSourceMap,
  type SourceMapPayload,
} from './sourceMap/sourceMapLoader';

export type BrowserV8CoverageResourceStore = {
  assetFiles: Map<string, string>;
  sourceMaps: Map<string, string>;
};

const normalizeSourceMap = (
  sourceMap: SourceMapPayload,
  rootPath: string,
): string => {
  if (!Array.isArray(sourceMap.sources)) {
    return JSON.stringify(sourceMap);
  }

  const webpackSourceRoot =
    typeof sourceMap.sourceRoot === 'string' &&
    sourceMap.sourceRoot.startsWith('webpack:')
      ? sourceMap.sourceRoot
      : undefined;
  const hasWebpackSources =
    webpackSourceRoot !== undefined ||
    sourceMap.sources.some(
      (source) => typeof source === 'string' && source.startsWith('webpack:'),
    );
  if (!hasWebpackSources) {
    return JSON.stringify(sourceMap);
  }

  const resolvedSources = new TraceMap(sourceMap).resolvedSources;
  const { sourceRoot: _, ...sourceMapWithoutRoot } = sourceMap;
  return JSON.stringify({
    ...sourceMapWithoutRoot,
    sources: sourceMap.sources.map((source, index) => {
      if (typeof source !== 'string') {
        return source;
      }

      if (!webpackSourceRoot && !source.startsWith('webpack:')) {
        return resolvedSources[index] ?? source;
      }

      let sourceUrl: URL;
      try {
        sourceUrl = webpackSourceRoot
          ? new URL(source, webpackSourceRoot)
          : new URL(source);
      } catch {
        return source;
      }
      if (sourceUrl.protocol !== 'webpack:') {
        return source;
      }

      let sourcePath = sourceUrl.pathname;
      try {
        sourcePath = decodeURIComponent(sourcePath);
      } catch {
        // A literal percent sign is a valid filename character.
      }
      sourcePath = sourcePath.replace(/^\/+/, '');
      return sourcePath.startsWith('webpack/runtime/')
        ? source
        : resolve(rootPath, sourcePath);
    }),
  });
};

export const takeBrowserV8Coverage = async ({
  collector,
  page,
  rootPath,
  fetchTimeout,
  sourceMapCache,
  resourceStore,
}: {
  collector: BrowserV8CoverageCollector;
  page: BrowserProviderPage;
  rootPath: string;
  fetchTimeout: number;
  sourceMapCache: Map<string, SourceMapPayload | null>;
  resourceStore?: BrowserV8CoverageResourceStore;
}): Promise<unknown | null> => {
  const rawEntries = await collector.take(page);
  const entries: {
    url: string;
    scriptId: string;
    filePath: string;
    functions: (typeof rawEntries)[number]['functions'];
  }[] = [];
  const assetFiles: Record<string, string> = {};
  const sourceMaps: Record<string, string> = {};

  await Promise.all(
    rawEntries.map(async (entry) => {
      const url = normalizeJavaScriptUrl(entry.url);
      if (!url || !entry.source) {
        return;
      }
      const sourceMap =
        resolveInlineSourceMap(entry.source) ??
        (await loadSourceMapForSource({
          jsUrl: url,
          signal: AbortSignal.timeout(fetchTimeout),
          source: entry.source,
        }));
      const normalizedSourceMap = sourceMap
        ? normalizeSourceMap(sourceMap, rootPath)
        : undefined;
      const filePath = url;

      entries.push({
        url,
        scriptId: entry.scriptId,
        filePath,
        functions: entry.functions,
      });
      if (resourceStore?.assetFiles.get(filePath) !== entry.source) {
        assetFiles[filePath] = entry.source;
        resourceStore?.assetFiles.set(filePath, entry.source);
      }

      sourceMapCache.set(url, sourceMap);
      if (normalizedSourceMap) {
        if (resourceStore?.sourceMaps.get(filePath) !== normalizedSourceMap) {
          sourceMaps[filePath] = normalizedSourceMap;
          resourceStore?.sourceMaps.set(filePath, normalizedSourceMap);
        }
      } else {
        resourceStore?.sourceMaps.delete(filePath);
      }
    }),
  );

  if (!entries.length) {
    return null;
  }

  return {
    entries,
    ...(Object.keys(assetFiles).length || Object.keys(sourceMaps).length
      ? { options: { assetFiles, sourceMaps } }
      : {}),
    root: rootPath,
  };
};
