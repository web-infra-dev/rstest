import {
  loadCachedAssets,
  WorkerAssetCache,
} from '../../../src/runtime/worker/assetCache';

describe('WorkerAssetCache', () => {
  it('evicts the least recently used assets by byte size', () => {
    const cache = new WorkerAssetCache(6);

    cache.set('a', '1234');
    cache.set('b', '12');
    expect(cache.get('a')).toBe('1234');

    cache.set('c', '12');

    expect(cache.get('a')).toBe('1234');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('12');
  });

  it('does not retain an asset larger than the budget', () => {
    const cache = new WorkerAssetCache(3);

    cache.set('large', '1234');

    expect(cache.get('large')).toBeUndefined();
  });

  it('clears entries when the budget changes', () => {
    const cache = new WorkerAssetCache(4);
    cache.set('asset', '1234');

    cache.configure(8);

    expect(cache.get('asset')).toBeUndefined();
  });

  it('retains cache hits needed by a task while fetched assets update the LRU', async () => {
    const cache = new WorkerAssetCache(6);
    cache.set('sourceMap:a', '');
    cache.set('sourceMap:b', '');
    cache.set('asset:a', 'aaaa');
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
    expect(cache.get('asset:a')).toBeUndefined();
    expect(cache.get('asset:b')).toBe('bbbb');
  });
});
