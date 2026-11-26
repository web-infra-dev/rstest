import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetServer } from '../../../../src/pool/assetServer';
import {
  createWorkerAssetCache,
  loadCachedAssets,
  loadTaskAssets,
} from '../../../../src/runtime/worker/vm/assetCache';
import { WorkerCache } from '../../../../src/runtime/worker/vm/cache';

describe('WorkerCache', () => {
  it('evicts the least recently used assets by byte size', () => {
    const workerCache = new WorkerCache(150);
    const cache = createWorkerAssetCache(workerCache).assetFiles;

    cache.set('a', '1234');
    cache.set('b', '12');
    expect(cache.get('a')).toBe('1234');

    cache.set('c', '12');

    expect(cache.get('a')).toBe('1234');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('12');
  });

  it('does not retain an asset larger than the budget', () => {
    const cache = createWorkerAssetCache(new WorkerCache(78)).assetFiles;

    cache.set('large', '1234');

    expect(cache.get('large')).toBeUndefined();
  });

  it('accounts for metadata when a cached value has no content bytes', () => {
    const cache = new WorkerCache(64).namespace<string>('empty', () => 0);

    cache.set('value', '');

    expect(cache.get('value')).toBeUndefined();
  });

  it('clears entries when the budget changes', () => {
    const workerCache = new WorkerCache(80);
    const cache = createWorkerAssetCache(workerCache).assetFiles;
    cache.set('asset', '1234');

    workerCache.configure(160);

    expect(cache.get('asset')).toBeUndefined();
  });

  it('retains cache hits needed by a task while fetched assets update the LRU', async () => {
    const cache = createWorkerAssetCache(new WorkerCache(230));
    cache.sourceMaps.set('a', '');
    cache.sourceMaps.set('b', '');
    cache.assetFiles.set('a', 'aaaa');
    const getAssetsByEntry = rs.fn(async () => ({
      assetFiles: { b: 'bbbb' },
      sourceMaps: {},
    }));

    const assets = await loadCachedAssets(['a', 'b'], cache, getAssetsByEntry);

    expect(getAssetsByEntry).toHaveBeenCalledWith(['b'], []);
    expect(assets).toEqual({
      assetFiles: { a: 'aaaa', b: 'bbbb' },
      sourceMaps: {},
    });
    expect(cache.assetFiles.get('a')).toBeUndefined();
    expect(cache.assetFiles.get('b')).toBe('bbbb');
  });

  it('stores missing source maps returned by the host as an empty sentinel', async () => {
    const cache = createWorkerAssetCache(new WorkerCache(256));
    const getAssetsByEntry = rs.fn(async () => ({
      assetFiles: {},
      // The host can return null for an asset without a source map at the IPC boundary.
      sourceMaps: { 'manifest.json': null },
    })) as unknown as Parameters<typeof loadCachedAssets>[2];

    const assets = await loadCachedAssets(
      ['manifest.json'],
      cache,
      getAssetsByEntry,
    );

    expect(assets.sourceMaps).toEqual({});
    expect(cache.sourceMaps.get('manifest.json')).toBe('');
  });

  it('shares one byte budget across cache namespaces', () => {
    const workerCache = new WorkerCache(150);
    const assets = createWorkerAssetCache(workerCache).assetFiles;
    const compilation = workerCache.namespace<string>('compilation', (value) =>
      Buffer.byteLength(value),
    );
    assets.set('asset', '1234');

    compilation.set('setup', '1234');

    expect(assets.get('asset')).toBeUndefined();
    expect(compilation.get('setup')).toBe('1234');
  });
});

it('reads bundled assets and their source maps from disk without requesting bytes from the host', async ({
  onTestFinished,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'rstest-worker-assets-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const external = join(directory, 'external.js');
  const externalMapPath = join(directory, 'external.js.map');
  const inline = join(directory, 'inline.js');
  const noMap = join(directory, 'plain.js');
  const inlineMap = '{"version":3,"sources":["inline.ts"]}';
  const externalMap = '{"version":3,"sources":["external.ts"]}';
  const inlineBundle = `//# sourceMappingURL=data:application/json;base64,${Buffer.from(inlineMap).toString('base64')}`;

  await Promise.all([
    writeFile(external, 'external bundle'),
    writeFile(externalMapPath, externalMap),
    writeFile(inline, inlineBundle),
    writeFile(noMap, 'plain bundle'),
  ]);

  const getAssetsByEntry = rs.fn();
  const assets = await loadTaskAssets(
    {
      assetNames: [external, inline, noMap],
      diskSourceMapPaths: {
        [external]: externalMapPath,
        [inline]: inline,
        [noMap]: noMap,
      },
      context: { pool: 'forks' },
    },
    undefined,
    { getAssetsByEntry },
  );

  expect(getAssetsByEntry).not.toHaveBeenCalled();
  expect(assets).toEqual({
    assetFiles: {
      [external]: Buffer.from('external bundle'),
      [inline]: Buffer.from(inlineBundle),
      [noMap]: Buffer.from('plain bundle'),
    },
    sourceMaps: { [external]: externalMap, [inline]: inlineMap },
  });
});

it('streams in-memory assets and source maps over AssetServer without invoking RPC', async ({
  onTestFinished,
}) => {
  const server = new AssetServer();
  onTestFinished(() => server.close());

  const inlineMap = '{"version":3,"sources":["inline.ts"]}';
  const externalMap = '{"version":3,"sources":["external.ts"]}';
  const inlineBundle = `//# sourceMappingURL=data:application/json;base64,${Buffer.from(inlineMap).toString('base64')}`;
  const largeBundle = Buffer.alloc(256 * 1024, 0x61);
  const files: Record<string, Buffer> = {
    '/mem/external.js': largeBundle,
    '/mem/external.js.map': Buffer.from(externalMap),
    '/mem/inline.js': Buffer.from(inlineBundle),
    '/mem/empty.js': Buffer.alloc(0),
  };

  const getAssetFiles = rs.fn(async (names: string[]) =>
    Object.fromEntries(names.map((name) => [name, files[name]!])),
  );
  const registered = await server.registerProvider(
    getAssetFiles,
    new Set(Object.keys(files)),
  );
  expect(registered).toBeDefined();

  const getAssetsByEntry = rs.fn();
  const assets = await loadTaskAssets(
    {
      assetNames: ['/mem/external.js', '/mem/inline.js', '/mem/empty.js'],
      assetSocket: {
        ...registered!,
        sourceMapPaths: {
          '/mem/external.js': '/mem/external.js.map',
          '/mem/inline.js': '/mem/inline.js',
        },
      },
      context: { pool: 'forks' },
    },
    undefined,
    { getAssetsByEntry },
  );

  expect(getAssetsByEntry).not.toHaveBeenCalled();
  expect(getAssetFiles).toHaveBeenCalledTimes(1);
  expect(assets.assetFiles).toEqual({
    '/mem/external.js': largeBundle,
    '/mem/inline.js': Buffer.from(inlineBundle),
    '/mem/empty.js': Buffer.alloc(0),
  });
  expect(assets.sourceMaps).toEqual({
    '/mem/external.js': externalMap,
    '/mem/inline.js': inlineMap,
  });
  // Each streamed asset gets its own backing ArrayBuffer so VM LRU eviction cannot pin siblings.
  expect((assets.assetFiles['/mem/external.js'] as Buffer).buffer).not.toBe(
    (assets.assetFiles['/mem/inline.js'] as Buffer).buffer,
  );
});

it('rejects AssetServer requests with an invalid token or disallowed path', async ({
  onTestFinished,
}) => {
  const server = new AssetServer();
  onTestFinished(() => server.close());

  const registered = await server.registerProvider(
    async () => ({ '/mem/allowed.js': Buffer.from('ok') }),
    new Set(['/mem/allowed.js']),
  );
  expect(registered).toBeDefined();

  const getAssetsByEntry = rs.fn();
  await expect(
    loadTaskAssets(
      {
        assetNames: ['/mem/allowed.js'],
        assetSocket: {
          ...registered!,
          token: 'wrong-token',
          sourceMapPaths: {},
        },
        context: { pool: 'forks' },
      },
      undefined,
      { getAssetsByEntry },
    ),
  ).rejects.toThrow('Invalid asset socket request');

  await expect(
    loadTaskAssets(
      {
        assetNames: ['/mem/secret.js'],
        assetSocket: {
          ...registered!,
          sourceMapPaths: {},
        },
        context: { pool: 'forks' },
      },
      undefined,
      { getAssetsByEntry },
    ),
  ).rejects.toThrow('Asset path not allowed');

  // Subsequent valid requests recover cleanly on a fresh connection.
  const recovered = await loadTaskAssets(
    {
      assetNames: ['/mem/allowed.js'],
      assetSocket: {
        ...registered!,
        sourceMapPaths: {},
      },
      context: { pool: 'forks' },
    },
    undefined,
    { getAssetsByEntry },
  );
  expect(recovered.assetFiles['/mem/allowed.js']).toEqual(Buffer.from('ok'));
});

it('reuses a keep-alive AssetServer connection across requests and reconnects if dropped while idle', async ({
  onTestFinished,
}) => {
  const server = new AssetServer();
  onTestFinished(() => server.close());

  const files: Record<string, Buffer> = {
    '/mem/a.js': Buffer.from('aaa'),
    '/mem/b.js': Buffer.alloc(0),
    '/mem/c.js': Buffer.from('ccc'),
  };
  const registered = await server.registerProvider(
    async (names) =>
      Object.fromEntries(names.map((name) => [name, files[name]!])),
    new Set(Object.keys(files)),
  );
  expect(registered).toBeDefined();

  const internal = server as unknown as {
    server: { on: (event: string, listener: () => void) => void };
    sockets: Set<{ destroy: () => void }>;
  };
  let acceptedConnections = 0;
  internal.server.on('connection', () => {
    acceptedConnections++;
  });

  const getAssetsByEntry = rs.fn();
  const fetchOne = (name: string) =>
    loadTaskAssets(
      {
        assetNames: [name],
        assetSocket: { ...registered!, sourceMapPaths: {} },
        context: { pool: 'vmForks' },
      },
      undefined,
      { getAssetsByEntry },
    );

  expect((await fetchOne('/mem/a.js')).assetFiles['/mem/a.js']).toEqual(
    files['/mem/a.js'],
  );
  expect((await fetchOne('/mem/b.js')).assetFiles['/mem/b.js']).toEqual(
    files['/mem/b.js'],
  );
  expect((await fetchOne('/mem/c.js')).assetFiles['/mem/c.js']).toEqual(
    files['/mem/c.js'],
  );
  expect(acceptedConnections).toBe(1);

  // Drop the idle keep-alive socket from the server side and verify transparent reconnect.
  for (const socket of internal.sockets) {
    socket.destroy();
  }
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect((await fetchOne('/mem/a.js')).assetFiles['/mem/a.js']).toEqual(
    files['/mem/a.js'],
  );
  expect(acceptedConnections).toBe(2);
});
