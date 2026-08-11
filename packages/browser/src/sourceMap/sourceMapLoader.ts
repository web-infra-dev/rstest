import {
  AnyMap,
  encodedMap,
  type DecodedSourceMapXInput,
  type EncodedSourceMapXInput,
  type SectionedSourceMapXInput,
} from '@jridgewell/trace-mapping';
import convert from 'convert-source-map';

export type SourceMapPayload = EncodedSourceMapXInput | DecodedSourceMapXInput;
type SourceMapPayloadInput = SourceMapPayload | SectionedSourceMapXInput;

export type LoadedSourceMap = {
  sourceMap: SourceMapPayload;
  sourceMapUrl: string;
};

type Fetcher = typeof fetch;

const flattenSourceMap = (
  sourceMap: SourceMapPayloadInput,
  sourceMapUrl?: string,
): SourceMapPayload => encodedMap(new AnyMap(sourceMap, sourceMapUrl));

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

    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

export const resolveInlineSourceMap = (
  code: string,
  sourceMapUrl?: string,
): SourceMapPayload | null => {
  try {
    const converter = convert.fromSource(code);
    return converter
      ? flattenSourceMap(
          converter.toObject() as SourceMapPayloadInput,
          sourceMapUrl,
        )
      : null;
  } catch {
    return null;
  }
};

export const loadSourceMapForSource = async ({
  jsUrl,
  signal,
  source,
  fetcher = fetch,
}: {
  jsUrl: string;
  signal?: AbortSignal;
  source: string;
  fetcher?: Fetcher;
}): Promise<LoadedSourceMap | null> => {
  const normalizedUrl = normalizeJavaScriptUrl(jsUrl);
  if (!normalizedUrl) {
    return null;
  }

  try {
    const matches = [...source.matchAll(convert.mapFileCommentRegex)];
    const finalMatch = matches.at(-1);
    const sourceMapUrl = finalMatch?.[1] ?? finalMatch?.[2]?.trim();
    if (!sourceMapUrl || sourceMapUrl.startsWith('data:')) {
      return null;
    }

    const resolvedSourceMapUrl = new URL(sourceMapUrl, normalizedUrl);
    if (
      resolvedSourceMapUrl.protocol !== 'http:' &&
      resolvedSourceMapUrl.protocol !== 'https:'
    ) {
      return null;
    }

    const mapResponse = await fetcher(
      resolvedSourceMapUrl.href,
      signal ? { signal } : undefined,
    );
    return mapResponse.ok
      ? {
          sourceMap: flattenSourceMap(
            (await mapResponse.json()) as SourceMapPayloadInput,
            resolvedSourceMapUrl.href,
          ),
          sourceMapUrl: resolvedSourceMapUrl.href,
        }
      : null;
  } catch {
    return null;
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
  const inlineMap = resolveInlineSourceMap(code, jsUrl);
  if (inlineMap) {
    return inlineMap;
  }

  const mapResponse = await fetcher(`${jsUrl}.map`);
  if (!mapResponse.ok) {
    return null;
  }

  return flattenSourceMap(
    (await mapResponse.json()) as SourceMapPayloadInput,
    `${jsUrl}.map`,
  );
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
