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
      return resolve(rootPath, sourceUrl.pathname.replace(/^\/+/, ''));
    }),
  });
};

export const takeBrowserV8Coverage = async ({
  collector,
  page,
  rootPath,
  sourceMapCache,
}: {
  collector: BrowserV8CoverageCollector;
  page: BrowserProviderPage;
  rootPath: string;
  sourceMapCache: Map<string, SourceMapPayload | null>;
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
      assetFiles[url] = entry.source;

      const sourceMap = await loadSourceMapWithCache({
        jsUrl: url,
        cache: sourceMapCache,
      });
      if (sourceMap) {
        sourceMaps[url] = normalizeSourceMap(sourceMap, rootPath);
      }
    }),
  );

  if (!entries.length) {
    return null;
  }

  return {
    entries,
    options: {
      assetFiles,
      sourceMaps,
    },
    root: rootPath,
  };
};
