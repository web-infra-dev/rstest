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
    const resourceStore = createResourceStore();

    const result = await takeBrowserV8Coverage({
      allowExternal: false,
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
      throw new Error('Expected a versioned browser coverage resource');
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(filePath).toMatch(
      /^http:\/\/localhost:4000\/static\/js\/test\.js#rstest-v8=[a-f0-9]{16}$/,
    );
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
      allowExternal: false,
      collector,
      fetchTimeout: 1000,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
    });

    expect(result).toBeNull();
  });

  it('pins deduplicated resources to the collected script version', async () => {
    const createSource = (originalLine: string) => {
      const sourceMap = {
        version: 3 as const,
        names: [],
        sources: ['webpack:///./src/value.ts'],
        sourcesContent: [originalLine],
        mappings: 'AAAA',
      };
      return [
        originalLine,
        `//# sourceMappingURL=data:application/json;base64,${Buffer.from(
          JSON.stringify(sourceMap),
        ).toString('base64')}`,
      ].join('\n');
    };
    const sourceA = createSource('var value = "A";');
    const sourceB = createSource('var value = "B";');
    let source = sourceA;
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
    const input = {
      allowExternal: false,
      collector,
      fetchTimeout: 1000,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
      resourceStore,
    };

    await takeBrowserV8Coverage(input);
    const repeatedA = await takeBrowserV8Coverage(input);
    source = sourceB;
    await takeBrowserV8Coverage(input);

    expect(repeatedA).not.toHaveProperty('options');
    expect(resourceStore.assetFiles.size).toBe(2);
    expect([...resourceStore.assetFiles.values()]).toEqual(
      expect.arrayContaining([sourceA, sourceB]),
    );
    expect(resourceStore.sourceMaps.size).toBe(2);
  });

  it('does not refetch cross-origin scripts by default', async () => {
    const collector: BrowserV8CoverageCollector = {
      start: async () => {},
      take: async () => [
        {
          url: 'https://cdn.example.com/dependency.js',
          scriptId: '1',
          source:
            'var dependency = true;\n//# sourceMappingURL=dependency.js.map',
          functions: [],
        },
      ],
    };
    const fetchSpy = rstest.spyOn(globalThis, 'fetch');
    // The collector fake does not inspect the provider page.
    const page = {} as BrowserProviderPage;

    const result = await takeBrowserV8Coverage({
      allowExternal: false,
      collector,
      fetchTimeout: 1000,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
    });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('isolates malformed inline source maps and bounds fallback fetches', async () => {
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
    const fetchSpy = rstest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(source))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    // The collector fake does not inspect the provider page.
    const page = {} as BrowserProviderPage;

    const result = await takeBrowserV8Coverage({
      allowExternal: false,
      collector,
      fetchTimeout: 1000,
      page,
      projectUrl: 'http://localhost:4000',
      rootPath: '/project',
      sourceMapCache: new Map(),
    });

    expect(result).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchSpy.mock.calls[1]?.[1]?.signal).toBe(
      fetchSpy.mock.calls[0]?.[1]?.signal,
    );
  });
});
