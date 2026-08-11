import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import { takeBrowserV8Coverage } from '../src/browserV8Coverage';
import type {
  BrowserProviderPage,
  BrowserV8CoverageCollector,
} from '../src/providers';

const createResourceStore = () => ({
  assetFiles: new Map<string, string>(),
  sourceMaps: new Map<string, string>(),
});

describe('browser V8 coverage', () => {
  afterEach(() => {
    rstest.restoreAllMocks();
  });

  it('uses the source map embedded in the collected script version', async () => {
    const sourceMap = {
      version: 3 as const,
      names: [],
      sourceRoot: 'webpack:///',
      sources: ['./src/old.ts'],
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
    const resourceStore = createResourceStore();

    const result = await takeBrowserV8Coverage({
      collector,
      fetchTimeout: 1000,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
      resourceStore,
    });
    const [filePath] = resourceStore.assetFiles.keys();
    if (!filePath) {
      throw new Error('Expected a browser coverage resource');
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(filePath).toBe(entry.url);
    expect(result).toEqual({
      entries: [
        {
          url: entry.url,
          scriptId: entry.scriptId,
          filePath,
          functions: entry.functions,
        },
      ],
      options: {
        assetFiles: { [filePath]: source },
        sourceMaps: {
          [filePath]: JSON.stringify({
            version: sourceMap.version,
            names: sourceMap.names,
            sources: ['/project/src/old.ts'],
            sourcesContent: sourceMap.sourcesContent,
            mappings: sourceMap.mappings,
          }),
        },
      },
      root: '/project',
    });
  });

  it('loads the external source map URL declared by the script', async () => {
    const sourceMap = {
      version: 3 as const,
      names: [],
      sources: ['/dependency/outside.ts', '../../src/value.ts'],
      sourcesContent: [
        'export const outside = true;',
        'export const value = 1;',
      ],
      mappings: 'AAAA',
    };
    const entry = {
      url: 'http://localhost:4000/static/js/test.js',
      scriptId: '1',
      source:
        'var value = 1;\n//# sourceMappingURL=../maps/value.js.map?version=1',
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
    const fetchSpy = rstest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(sourceMap)));
    // The collector fake does not inspect the provider page.
    const page = {} as BrowserProviderPage;

    const resourceStore = createResourceStore();

    await takeBrowserV8Coverage({
      collector,
      fetchTimeout: 0,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
      resourceStore,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://localhost:4000/static/maps/value.js.map?version=1',
    );
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeUndefined();
    expect(resourceStore.sourceMaps.get(entry.url)).toBe(
      JSON.stringify({
        ...sourceMap,
        sources: ['/dependency/outside.ts', '/project/src/value.ts'],
      }),
    );
  });

  it('preserves literal percent signs in webpack source paths', async () => {
    const sourceMap = {
      version: 3 as const,
      names: [],
      sources: ['webpack:///./src/100%.ts'],
      sourcesContent: ['export const value = 100;'],
      mappings: 'AAAA',
    };
    const source = [
      'var value = 100;',
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(
        JSON.stringify(sourceMap),
      ).toString('base64')}`,
    ].join('\n');
    const collector: BrowserV8CoverageCollector = {
      start: async () => {},
      take: async () => [
        {
          url: 'http://localhost:4000/static/js/test.js',
          scriptId: '1',
          source,
          functions: [],
        },
      ],
    };
    const resourceStore = createResourceStore();
    // The collector fake does not inspect the provider page.
    const page = {} as BrowserProviderPage;
    await takeBrowserV8Coverage({
      collector,
      fetchTimeout: 1000,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
      resourceStore,
    });

    expect([...resourceStore.sourceMaps.values()]).toEqual([
      JSON.stringify({
        ...sourceMap,
        sources: ['/project/src/100%.ts'],
      }),
    ]);
  });

  it('resolves non-webpack sources before removing a mixed sourceRoot', async () => {
    const sourceMap = {
      version: 3 as const,
      names: [],
      sourceRoot: 'https://cdn.example.com/sources/',
      sources: ['dependency.ts', 'webpack:///./src/value.ts'],
      sourcesContent: [
        'export const dependency = true;',
        'export const value = 1;',
      ],
      mappings: 'AAAA',
    };
    const source = [
      'var value = 1;',
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(
        JSON.stringify(sourceMap),
      ).toString('base64')}`,
    ].join('\n');
    const collector: BrowserV8CoverageCollector = {
      start: async () => {},
      take: async () => [
        {
          url: 'http://localhost:4000/static/js/test.js',
          scriptId: '1',
          source,
          functions: [],
        },
      ],
    };
    // The collector fake does not inspect the provider page.
    const page = {} as BrowserProviderPage;
    const resourceStore = createResourceStore();

    await takeBrowserV8Coverage({
      collector,
      fetchTimeout: 1000,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
      resourceStore,
    });

    expect(
      resourceStore.sourceMaps.get('http://localhost:4000/static/js/test.js'),
    ).toBe(
      JSON.stringify({
        version: sourceMap.version,
        names: sourceMap.names,
        sources: [
          'https://cdn.example.com/sources/dependency.ts',
          '/project/src/value.ts',
        ],
        sourcesContent: sourceMap.sourcesContent,
        mappings: sourceMap.mappings,
      }),
    );
  });

  it('preserves external identity for cross-origin webpack sources', async () => {
    const sourceMap = {
      version: 3 as const,
      names: [],
      sources: ['webpack:///./src/dependency.ts'],
      sourcesContent: ['export const dependency = true;'],
      mappings: 'AAAA',
    };
    const source = [
      'var dependency = true;',
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(
        JSON.stringify(sourceMap),
      ).toString('base64')}`,
    ].join('\n');
    const entry = {
      url: 'https://cdn.example.com/dependency.js',
      scriptId: '1',
      source,
      functions: [],
    };
    const collector: BrowserV8CoverageCollector = {
      start: async () => {},
      take: async () => [entry],
    };
    const page = {} as BrowserProviderPage;

    const result = await takeBrowserV8Coverage({
      collector,
      fetchTimeout: 1000,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
    });

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
            sources: ['https://cdn.example.com/src/dependency.ts'],
          }),
        },
      },
      root: '/project',
    });
  });

  it('isolates malformed inline source maps', async () => {
    const source = [
      'var value = 1;',
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(
        'not json',
      ).toString('base64')}`,
    ].join('\n');
    const collector: BrowserV8CoverageCollector = {
      start: async () => {},
      take: async () => [
        {
          url: 'http://localhost:4000/static/js/test.js',
          scriptId: '1',
          source,
          functions: [],
        },
      ],
    };
    const fetchSpy = rstest.spyOn(globalThis, 'fetch');
    // The collector fake does not inspect the provider page.
    const page = {} as BrowserProviderPage;

    const result = await takeBrowserV8Coverage({
      collector,
      fetchTimeout: 1000,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
    });

    expect(result).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
