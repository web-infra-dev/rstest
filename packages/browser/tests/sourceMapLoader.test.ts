import { describe, expect, it } from '@rstest/core';
import { loadSourceMapWithCache } from '../src/sourceMap/sourceMapLoader';

describe('source map loader', () => {
  const sourceMap = {
    version: 3 as const,
    names: [],
    sources: ['./src/value.ts'],
    sourcesContent: ['export const value = 1;'],
    mappings: 'AAAA',
  };

  const createRecordingFetcher =
    (requestedUrls: string[]) =>
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      requestedUrls.push(url);
      return url.includes('.map')
        ? new Response(JSON.stringify(sourceMap))
        : new Response('const value = 1;');
    };

  it('inserts the fallback map suffix before the script query', async () => {
    const requestedUrls: string[] = [];

    const result = await loadSourceMapWithCache({
      jsUrl: 'http://localhost:4000/app.js?version=1',
      cache: new Map(),
      fetcher: createRecordingFetcher(requestedUrls),
    });

    expect(requestedUrls).toEqual([
      'http://localhost:4000/app.js?version=1',
      'http://localhost:4000/app.js.map?version=1',
    ]);
    expect(result).toMatchObject(sourceMap);
  });

  describe('shouldFetchExternalMap', () => {
    it('skips the external .map request when the code fails the predicate', async () => {
      const requestedUrls: string[] = [];

      const result = await loadSourceMapWithCache({
        jsUrl: 'http://localhost:4000/app.js',
        cache: new Map(),
        fetcher: createRecordingFetcher(requestedUrls),
        shouldFetchExternalMap: () => false,
      });

      expect(requestedUrls).toEqual(['http://localhost:4000/app.js']);
      expect(result).toBeNull();
    });

    it('fetches the external .map when the code passes the predicate', async () => {
      const requestedUrls: string[] = [];

      const result = await loadSourceMapWithCache({
        jsUrl: 'http://localhost:4000/app.js',
        cache: new Map(),
        fetcher: createRecordingFetcher(requestedUrls),
        shouldFetchExternalMap: () => true,
      });

      expect(requestedUrls).toEqual([
        'http://localhost:4000/app.js',
        'http://localhost:4000/app.js.map',
      ]);
      expect(result).toMatchObject(sourceMap);
    });
  });
});
