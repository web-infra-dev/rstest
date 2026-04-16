import type {
  DecodedSourceMapXInput,
  EncodedSourceMapXInput,
} from '@jridgewell/trace-mapping';
import convert from 'convert-source-map';

export type SourceMapPayload = EncodedSourceMapXInput | DecodedSourceMapXInput;

type Fetcher = typeof fetch;

export const normalizeJavaScriptUrl = (
  value: string,
  options?: {
    origin?: string;
  },
): string | null => {
  try {
    const url = options?.origin
      ? new URL(value, options.origin)
      : new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const resolveInlineSourceMap = (code: string): SourceMapPayload | null => {
  const converter = convert.fromSource(code);
  if (!converter) {
    return null;
  }

  return converter.toObject() as SourceMapPayload;
};

const fetchSourceMap = async (
  jsUrl: string,
  fetcher: Fetcher,
): Promise<SourceMapPayload | null> => {
  const jsResponse = await fetcher(jsUrl);
  if (!jsResponse.ok) {
    return null;
  }

  const code = await jsResponse.text();
  const inlineMap = resolveInlineSourceMap(code);
  if (inlineMap) {
    return inlineMap;
  }

  const mapResponse = await fetcher(`${jsUrl}.map`);
  if (!mapResponse.ok) {
    return null;
  }

  return (await mapResponse.json()) as SourceMapPayload;
};

export const loadSourceMapWithCache = async ({
  jsUrl,
  cache,
  force = false,
  origin,
  fetcher = fetch,
}: {
  jsUrl: string;
  cache: Map<string, SourceMapPayload | null>;
  force?: boolean;
  origin?: string;
  fetcher?: Fetcher;
}): Promise<SourceMapPayload | null> => {
  const normalizedUrl = normalizeJavaScriptUrl(jsUrl, { origin });
  if (!normalizedUrl) {
    return null;
  }

  if (!force && cache.has(normalizedUrl)) {
    return cache.get(normalizedUrl) ?? null;
  }

  try {
    const sourceMap = await fetchSourceMap(normalizedUrl, fetcher);
    cache.set(normalizedUrl, sourceMap);
    return sourceMap;
  } catch {
    cache.set(normalizedUrl, null);
    return null;
  }
};
