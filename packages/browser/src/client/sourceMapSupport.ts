import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import {
  loadSourceMapWithCache,
  normalizeJavaScriptUrl,
  type SourceMapPayload,
} from '../sourceMap/sourceMapLoader';

// Source map cache: JS URL → TraceMap
const sourceMapCache = new Map<string, TraceMap | null>();
const sourceMapPayloadCache = new Map<string, SourceMapPayload | null>();

/**
 * Get TraceMap for specified URL (sync cache lookup)
 */
const getSourceMap = (url: string): TraceMap | null => {
  return sourceMapCache.get(url) ?? null;
};

/**
 * Preload source map for specified JS URL.
 * First tries to extract inline source map from JS code,
 * then falls back to fetching external .map file.
 *
 * @param jsUrl - The URL of the JS file
 * @param force - If true, bypass cache and always fetch fresh source map
 */
const preloadSourceMap = async (
  jsUrl: string,
  force = false,
): Promise<void> => {
  const normalizedUrl = normalizeJavaScriptUrl(jsUrl, {
    origin: window.location.origin,
  });
  if (!normalizedUrl) {
    return;
  }

  if (!force && sourceMapCache.has(normalizedUrl)) return;

  const sourceMap = await loadSourceMapWithCache({
    jsUrl: normalizedUrl,
    cache: sourceMapPayloadCache,
    force,
    origin: window.location.origin,
  });

  sourceMapCache.set(normalizedUrl, sourceMap ? new TraceMap(sourceMap) : null);
};

/**
 * Get all script URLs currently on the page.
 * Used to detect newly loaded chunk scripts.
 */
export const getScriptUrls = (): Set<string> => {
  const scripts = document.querySelectorAll('script[src]');
  const urls = new Set<string>();
  for (const script of scripts) {
    const src = script.getAttribute('src');
    if (src) {
      // Normalize to full URL
      const fullUrl = src.startsWith('http')
        ? src
        : `${window.location.origin}${src.startsWith('/') ? '' : '/'}${src}`;
      urls.add(fullUrl);
    }
  }
  return urls;
};

/**
 * Find the newly added script URL by comparing script sets.
 * Returns the first new script URL found, or null if none.
 */
export const findNewScriptUrl = (
  beforeUrls: Set<string>,
  afterUrls: Set<string>,
): string | null => {
  for (const url of afterUrls) {
    if (!beforeUrls.has(url)) {
      return url;
    }
  }
  return null;
};

/**
 * Preload source map for a test file's chunk URL.
 *
 * Always fetches fresh source map to handle file changes during watch mode.
 *
 * @param chunkUrl - The full URL of the chunk JS file
 */
export const preloadTestFileSourceMap = async (
  chunkUrl: string,
): Promise<void> => {
  // Always force refresh to ensure we have the latest source map
  // This handles the case where user saves file during test execution
  await preloadSourceMap(chunkUrl, true);
};

/**
 * Preload source map for the runner.js file.
 *
 * This is essential for inline snapshot support because the snapshot code
 * runs in runner.js (which contains @rstest/core/browser-runtime).
 * Without this, stack traces from inline snapshots cannot be mapped back
 * to the original source files.
 */
export const preloadRunnerSourceMap = async (): Promise<void> => {
  const runnerUrl = `${window.location.origin}/static/js/runner.js`;
  await preloadSourceMap(runnerUrl);
};

/**
 * Clear cache (for testing purposes)
 */
export const clearCache = (): void => {
  sourceMapCache.clear();
  sourceMapPayloadCache.clear();
};

/**
 * Stack frame interface matching @vitest/snapshot's format
 */
export interface StackFrame {
  file: string;
  line: number;
  column: number;
  method?: string;
}

/**
 * Map a stack frame from bundled URL to original source file.
 * This is used by BrowserSnapshotEnvironment.processStackTrace
 */
export const mapStackFrame = (frame: StackFrame): StackFrame => {
  const { file, line, column } = frame;

  const fullUrl = normalizeJavaScriptUrl(file, {
    origin: window.location.origin,
  });
  if (!fullUrl) {
    return frame;
  }

  const traceMap = getSourceMap(fullUrl);
  if (!traceMap) {
    return frame;
  }

  const pos = originalPositionFor(traceMap, {
    line,
    column: column - 1, // source map uses 0-based column
  });

  if (pos.source && pos.line != null && pos.column != null) {
    return {
      ...frame,
      file: pos.source,
      line: pos.line,
      column: pos.column + 1, // convert back to 1-based
      method: pos.name || frame.method,
    };
  }

  return frame;
};
