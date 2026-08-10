import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import { takeBrowserV8Coverage } from '../src/browserV8Coverage';
import type {
  BrowserProviderPage,
  BrowserV8CoverageCollector,
} from '../src/providers';

describe('browser V8 coverage', () => {
  afterEach(() => {
    rstest.restoreAllMocks();
  });

  it('uses the source map embedded in the collected script version', async () => {
    const sourceMap = {
      version: 3 as const,
      names: [],
      sources: ['webpack:///./src/old.ts'],
      sourcesContent: ['export const value = 1;'],
      mappings: 'AAAA',
    };
    const source = [
      'var value = 1;',
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(
        JSON.stringify(sourceMap),
      ).toString('base64')}`,
    ].join('\n');
    const entry = {
      url: 'http://localhost:4000/static/js/test.js',
      scriptId: '1',
      source,
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: 14, count: 1 }],
        },
      ],
    };
    const collector: BrowserV8CoverageCollector = {
      start: async () => {},
      take: async () => [entry],
    };
    const fetchSpy = rstest.spyOn(globalThis, 'fetch');
    // The collector fake does not inspect the provider page.
    const page = {} as BrowserProviderPage;

    const result = await takeBrowserV8Coverage({
      collector,
      page,
      rootPath: '/project',
      sourceMapCache: new Map(),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      entries: [
        {
          url: entry.url,
          scriptId: entry.scriptId,
          filePath: entry.url,
          functions: entry.functions,
        },
      ],
      options: {
        assetFiles: { [entry.url]: source },
        sourceMaps: {
          [entry.url]: JSON.stringify({
            ...sourceMap,
            sources: ['/project/src/old.ts'],
          }),
        },
      },
      root: '/project',
    });
  });

  it('drops coverage when a watch rebuild replaced the script URL', async () => {
    const entry = {
      url: 'http://localhost:4000/static/js/test.js',
      scriptId: '1',
      source: 'var oldValue = 1;\n//# sourceMappingURL=test.js.map',
      functions: [
        {
          functionName: '',
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: 17, count: 1 }],
        },
      ],
    };
    const collector: BrowserV8CoverageCollector = {
      start: async () => {},
      take: async () => [entry],
    };
    rstest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('var newValue = 2;'));
    // The collector fake does not inspect the provider page.
    const page = {} as BrowserProviderPage;

    const result = await takeBrowserV8Coverage({
      collector,
      page,
      rootPath: '/project',
      sourceMapCache: new Map(),
    });

    expect(result).toBeNull();
  });
});
