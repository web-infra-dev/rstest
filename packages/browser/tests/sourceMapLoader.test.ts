import { describe, expect, it } from '@rstest/core';
import { loadSourceMapWithCache } from '../src/sourceMap/sourceMapLoader';

describe('source map loader', () => {
  it('inserts the fallback map suffix before the script query', async () => {
    const requestedUrls: string[] = [];
    const sourceMap = {
      version: 3 as const,
      names: [],
      sources: ['./src/value.ts'],
      sourcesContent: ['export const value = 1;'],
      mappings: 'AAAA',
    };
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      requestedUrls.push(url);
      return url.includes('.map')
        ? new Response(JSON.stringify(sourceMap))
        : new Response('const value = 1;');
    };

    const result = await loadSourceMapWithCache({
      jsUrl: 'http://localhost:4000/app.js?version=1',
      cache: new Map(),
      fetcher,
    });

    expect(requestedUrls).toEqual([
      'http://localhost:4000/app.js?version=1',
      'http://localhost:4000/app.js.map?version=1',
    ]);
    expect(result).toMatchObject(sourceMap);
  });
});
