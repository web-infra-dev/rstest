import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import convert from 'convert-source-map';

// Source map cache: JS URL → TraceMap
const sourceMapCache = new Map<string, TraceMap | null>();

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
  if (!force && sourceMapCache.has(jsUrl)) return;

  try {
    // First, fetch JS file and try to extract inline source map
    const jsResponse = await fetch(jsUrl);
    if (!jsResponse.ok) {
      sourceMapCache.set(jsUrl, null);
      return;
    }

    const code = await jsResponse.text();

    // Try to extract inline source map using convert-source-map
    const inlineConverter = convert.fromSource(code);
    if (inlineConverter) {
      const mapObject = inlineConverter.toObject();
      sourceMapCache.set(jsUrl, new TraceMap(mapObject));
      return;
    }

    // Fallback: try to fetch external .map file
    const mapUrl = `${jsUrl}.map`;
    const mapResponse = await fetch(mapUrl);
    if (mapResponse.ok) {
      const mapJson = await mapResponse.json();
      sourceMapCache.set(jsUrl, new TraceMap(mapJson));
      return;
    }

    // No source map found
    sourceMapCache.set(jsUrl, null);
  } catch {
    sourceMapCache.set(jsUrl, null);
  }
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
 * Clear cache (for testing purposes)
 */
export const clearCache = (): void => {
  sourceMapCache.clear();
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

  // Normalize file path to full URL for cache lookup
  let fullUrl = file;
  if (!file.startsWith('http://') && !file.startsWith('https://')) {
    // Convert relative path to full URL
    fullUrl = `${window.location.origin}${file.startsWith('/') ? '' : '/'}${file}`;
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
