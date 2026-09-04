import {
  createWorkerAssetCache,
  loadCachedAssets,
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
