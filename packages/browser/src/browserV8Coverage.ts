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

  return JSON.stringify({
    ...sourceMap,
    sources: sourceMap.sources.map((source) => {
      if (typeof source !== 'string' || !source.startsWith('webpack:')) {
        return source;
      }

      const sourceUrl = new URL(source);
      const sourcePath = decodeURIComponent(sourceUrl.pathname).replace(
        /^\/+/,
        '',
      );
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
  sourceMapCache,
  resourceStore,
}: {
  collector: BrowserV8CoverageCollector;
  page: BrowserProviderPage;
  rootPath: string;
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

      const inlineSourceMap = resolveInlineSourceMap(entry.source);
      const sourceMapResult = inlineSourceMap
        ? { status: 'matched' as const, sourceMap: inlineSourceMap }
        : await loadSourceMapForSource({ jsUrl: url, source: entry.source });
      // A headed watch rebuild can replace a stable bundle URL while the old
      // script is still executing. Its ranges must not be paired with the new
      // build's map; the next stable rerun will collect that version instead.
      if (sourceMapResult.status !== 'matched') {
        return;
      }

      entries.push({
        url,
        scriptId: entry.scriptId,
        filePath: url,
        functions: entry.functions,
      });
      if (resourceStore?.assetFiles.get(url) !== entry.source) {
        assetFiles[url] = entry.source;
        resourceStore?.assetFiles.set(url, entry.source);
      }

      const sourceMap = sourceMapResult.sourceMap;
      sourceMapCache.set(url, sourceMap);
      if (sourceMap) {
        const normalizedSourceMap = normalizeSourceMap(sourceMap, rootPath);
        if (resourceStore?.sourceMaps.get(url) !== normalizedSourceMap) {
          sourceMaps[url] = normalizedSourceMap;
          resourceStore?.sourceMaps.set(url, normalizedSourceMap);
        }
      } else {
        resourceStore?.sourceMaps.delete(url);
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
