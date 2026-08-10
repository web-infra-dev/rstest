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

export const resolveInlineSourceMap = (
  code: string,
): SourceMapPayload | null => {
  const converter = convert.fromSource(code);
  if (!converter) {
    return null;
  }

  return converter.toObject() as SourceMapPayload;
};

export const loadSourceMapForSource = async ({
  jsUrl,
  source,
  fetcher = fetch,
}: {
  jsUrl: string;
  source: string;
  fetcher?: Fetcher;
}): Promise<
  | { status: 'matched'; sourceMap: SourceMapPayload | null }
  | { status: 'mismatched' | 'unavailable' }
> => {
  const normalizedUrl = normalizeJavaScriptUrl(jsUrl);
  if (!normalizedUrl) {
    return { status: 'unavailable' };
  }

  try {
    const jsResponse = await fetcher(normalizedUrl);
    if (!jsResponse.ok) {
      return { status: 'unavailable' };
    }

    const currentSource = await jsResponse.text();
    if (currentSource !== source) {
      return { status: 'mismatched' };
    }

    const inlineMap = resolveInlineSourceMap(currentSource);
    if (inlineMap) {
      return { status: 'matched', sourceMap: inlineMap };
    }

    const mapResponse = await fetcher(`${normalizedUrl}.map`);
    return {
      status: 'matched',
      sourceMap: mapResponse.ok
        ? ((await mapResponse.json()) as SourceMapPayload)
        : null,
    };
  } catch {
    return { status: 'unavailable' };
  }
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
