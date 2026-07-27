import { describe, expect, it, rs } from '@rstest/core';
import { createCoverageResourceLoaders } from '../../src/core/executors/nodeExecutor';

describe('createCoverageResourceLoaders', () => {
  it('loads resources by normalized aliases using canonical asset names', async () => {
    const privateAsset = '/private/var/folders/project/dist/Chunk.js';
    const windowsAsset = 'C:/Repo/dist/Other.js';
    const privateAlias = '/var/folders/project/dist/chunk.js';
    const windowsAlias = 'c:\\repo\\dist\\other.js';
    const requestedAssets = [privateAlias, windowsAlias];
    const getAssetFiles = rs.fn(async (names: string[]) =>
      Object.fromEntries(names.map((name) => [name, `source:${name}`])),
    );
    const getSourceMaps = rs.fn(async (names: string[]) =>
      Object.fromEntries(names.map((name) => [name, `map:${name}`])),
    );
    const loaders = createCoverageResourceLoaders([
      {
        assetNames: [privateAsset, windowsAsset],
        getAssetFiles,
        getSourceMaps,
      },
    ]);

    await expect(loaders.loadAssetFiles(requestedAssets)).resolves.toEqual({
      [privateAlias]: `source:${privateAsset}`,
      [windowsAlias]: `source:${windowsAsset}`,
    });
    await expect(loaders.loadSourceMaps(requestedAssets)).resolves.toEqual({
      [privateAlias]: `map:${privateAsset}`,
      [windowsAlias]: `map:${windowsAsset}`,
    });
    expect(getAssetFiles).toHaveBeenCalledWith([privateAsset, windowsAsset]);
    expect(getSourceMaps).toHaveBeenCalledWith([privateAsset, windowsAsset]);
  });
});
