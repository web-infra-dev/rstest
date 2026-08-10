import { resolve } from 'pathe';
import type {
  BrowserProviderPage,
  BrowserV8CoverageCollector,
} from './providers';
import {
  loadSourceMapWithCache,
  normalizeJavaScriptUrl,
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

      const sourceMap = await loadSourceMapWithCache({
        jsUrl: url,
        cache: sourceMapCache,
        // Browser bundles can be rebuilt in place during watch. The URL is
        // stable after normalization, so a cached map may describe an older
        // version of the JavaScript whose offsets we just collected.
        force: true,
      });
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
