import { TraceMap } from '@jridgewell/trace-mapping';
import { isAbsolute, resolve } from 'pathe';
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

const resolveCoverageResourceUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const resolveProjectHttpSource = (
  source: string,
  rootPath: string,
  projectOrigin: string,
): string => {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return source;
  }
  if (
    (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') ||
    sourceUrl.origin !== projectOrigin
  ) {
    return source;
  }

  let sourcePath = sourceUrl.pathname;
  try {
    sourcePath = decodeURIComponent(sourcePath);
  } catch {
    // A literal percent sign is a valid filename character.
  }
  return resolve(rootPath, sourcePath.replace(/^\/+/, ''));
};

const normalizeSourceMap = (
  sourceMap: SourceMapPayload,
  rootPath: string,
  sourceMapUrl: string,
  scriptOrigin: string,
  projectOrigin: string,
): string => {
  if (!Array.isArray(sourceMap.sources)) {
    return JSON.stringify(sourceMap);
  }

  const webpackSourceRoot =
    typeof sourceMap.sourceRoot === 'string' &&
    sourceMap.sourceRoot.startsWith('webpack:')
      ? sourceMap.sourceRoot
      : undefined;
  const resolvedSources = new TraceMap(sourceMap, sourceMapUrl).resolvedSources;
  const { sourceRoot: _, ...sourceMapWithoutRoot } = sourceMap;
  return JSON.stringify({
    ...sourceMapWithoutRoot,
    sources: sourceMap.sources.map((source, index) => {
      if (typeof source !== 'string') {
        return source;
      }
      if (isAbsolute(source)) {
        return source;
      }

      let sourceUrl: URL;
      try {
        sourceUrl = webpackSourceRoot
          ? new URL(source, webpackSourceRoot)
          : new URL(source);
      } catch {
        const resolvedSource = resolvedSources[index] ?? source;
        return resolveProjectHttpSource(
          resolvedSource,
          rootPath,
          projectOrigin,
        );
      }
      if (sourceUrl.protocol !== 'webpack:') {
        const resolvedSource = resolvedSources[index] ?? source;
        return resolveProjectHttpSource(
          resolvedSource,
          rootPath,
          projectOrigin,
        );
      }

      let sourcePath = sourceUrl.pathname;
      try {
        sourcePath = decodeURIComponent(sourcePath);
      } catch {
        // A literal percent sign is a valid filename character.
      }
      sourcePath = sourcePath.replace(/^\/+/, '');
      if (sourcePath.startsWith('webpack/runtime/')) {
        return source;
      }
      return scriptOrigin === projectOrigin
        ? resolve(rootPath, sourcePath)
        : new URL(sourcePath, `${scriptOrigin}/`).href;
    }),
  });
};

export const takeBrowserV8Coverage = async ({
  collector,
  page,
  projectUrl,
  rootPath,
  fetchTimeout,
  sourceMapCache,
  resourceStore,
}: {
  collector: BrowserV8CoverageCollector;
  page: BrowserProviderPage;
  projectUrl: string;
  rootPath: string;
  fetchTimeout: number;
  sourceMapCache: Map<string, SourceMapPayload | null>;
  resourceStore?: BrowserV8CoverageResourceStore;
}): Promise<unknown | null> => {
  const rawEntries = await collector.take(page);
  const projectOrigin = new URL(projectUrl).origin;
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
      const url = resolveCoverageResourceUrl(entry.url);
      const fetchUrl = normalizeJavaScriptUrl(entry.url);
      if (!url || !fetchUrl || !entry.source) {
        return;
      }
      const inlineSourceMap = resolveInlineSourceMap(entry.source);
      const loadedSourceMap = inlineSourceMap
        ? null
        : await loadSourceMapForSource({
            jsUrl: url,
            signal:
              fetchTimeout > 0 ? AbortSignal.timeout(fetchTimeout) : undefined,
            source: entry.source,
          });
      const sourceMap = inlineSourceMap ?? loadedSourceMap?.sourceMap;
      const normalizedSourceMap = sourceMap
        ? normalizeSourceMap(
            sourceMap,
            rootPath,
            loadedSourceMap?.sourceMapUrl ?? url,
            new URL(url).origin,
            projectOrigin,
          )
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

      if (sourceMap) {
        sourceMapCache.set(fetchUrl, sourceMap);
      } else {
        sourceMapCache.delete(fetchUrl);
      }
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
