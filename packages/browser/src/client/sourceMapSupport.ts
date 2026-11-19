import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import {
  loadSourceMapWithCache,
  normalizeJavaScriptUrl,
} from '../sourceMap/sourceMapLoader';

// Source map cache: JS URL → TraceMap
const sourceMapCache = new Map<string, TraceMap | null>();

/**
 * Get TraceMap for specified URL (sync cache lookup)
 */
const getSourceMap = (url: string): TraceMap | null => {
  return sourceMapCache.get(url) ?? null;
};

/**
 * Markers whose presence in a test chunk means inline snapshot assertions
 * may run in it: `@vitest/snapshot`'s `_resolveInlineStack` walks the frames
 * below its `__INLINE_SNAPSHOT__` marker, and those frames live in the test
 * file's own chunk. Chunks without these markers never need their source
 * map client-side, so the `.map` fetch and `TraceMap` build are skipped.
 */
const INLINE_SNAPSHOT_MARKERS = [
  'toMatchInlineSnapshot',
  'toThrowErrorMatchingInlineSnapshot',
  '__INLINE_SNAPSHOT',
];

const mayContainInlineSnapshots = (code: string): boolean =>
  INLINE_SNAPSHOT_MARKERS.some((marker) => code.includes(marker));

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
 * Always fetches fresh source map to handle file changes during watch mode,
 * but only when the chunk actually contains inline snapshot calls: the chunk
 * code is fetched either way (it is also where an inline source map would
 * live), while the `.map` request and `TraceMap` build are conditional.
 *
 * @param chunkUrl - The full URL of the chunk JS file
 */
export const preloadTestFileSourceMap = async (
  chunkUrl: string,
): Promise<void> => {
  const normalizedUrl = normalizeJavaScriptUrl(chunkUrl, {
    origin: window.location.origin,
  });
  if (!normalizedUrl) {
    return;
  }

  // Client-side stack mapping only serves inline snapshots (see
  // `mayContainInlineSnapshots`): skip the external `.map` for chunks without
  // those markers. `force` makes the cache write-only, so a throwaway Map
  // keeps the payload — possibly with `sourcesContent` — from outliving the
  // call.
  const sourceMap = await loadSourceMapWithCache({
    jsUrl: normalizedUrl,
    cache: new Map(),
    force: true,
    origin: window.location.origin,
    shouldFetchExternalMap: mayContainInlineSnapshots,
  });

  sourceMapCache.set(normalizedUrl, sourceMap ? new TraceMap(sourceMap) : null);
};

/**
 * Stack frame interface matching @vitest/snapshot's format
 */
interface StackFrame {
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
