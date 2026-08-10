import {
  getAssetBuffer,
  getAssetText,
  prepareAssetFilesForIPC,
} from '../../src/utils/assetFiles';

describe('asset files', () => {
  it('keeps buffers for Node worker transports', () => {
    const content = Buffer.from([0, 0xff, 0x80, 0x41]);
    const assetFiles = { '/asset.bin': content };

    expect(prepareAssetFilesForIPC(assetFiles, 'forks')).toBe(assetFiles);
  });

  it('uses JSON-safe strings for Bun forks', () => {
    const originalBunVersion = process.versions.bun;
    process.versions.bun = originalBunVersion ?? '1.0.0';

    try {
      expect(
        prepareAssetFilesForIPC(
          {
            '/entry.js': Buffer.from('export default 1'),
            '/asset.bin': Buffer.from([0, 0xff, 0x80, 0x41]),
          },
          'forks',
        ),
      ).toEqual({
        '/entry.js': 'export default 1',
        '/asset.bin': {
          encoding: 'base64',
          data: Buffer.from([0, 0xff, 0x80, 0x41]).toString('base64'),
        },
      });
    } finally {
      if (originalBunVersion === undefined) {
        Reflect.deleteProperty(process.versions, 'bun');
      } else {
        process.versions.bun = originalBunVersion;
      }
    }
  });

  it('keeps buffers for Bun threads', () => {
    const originalBunVersion = process.versions.bun;
    process.versions.bun = originalBunVersion ?? '1.0.0';
    const assetFiles = {
      '/asset.bin': Buffer.from([0, 0xff, 0x80, 0x41]),
    };

    try {
      expect(prepareAssetFilesForIPC(assetFiles, 'threads')).toBe(assetFiles);
    } finally {
      if (originalBunVersion === undefined) {
        Reflect.deleteProperty(process.versions, 'bun');
      } else {
        process.versions.bun = originalBunVersion;
      }
    }
  });

  it('normalizes thread and Bun payloads at the text or buffer consumer', () => {
    const backing = Uint8Array.from([1, 2, 0, 0xff, 0x80, 0x41, 3]);
    const threadContent = backing.subarray(2, 6);
    const assetFiles = {
      '/thread.bin': threadContent,
      '/bun.bin': {
        encoding: 'base64' as const,
        data: Buffer.from([0, 0xff, 0x80, 0x41]).toString('base64'),
      },
      '/entry.js': Buffer.from('export default 1'),
    };

    expect(getAssetBuffer(assetFiles, '/thread.bin')).toEqual(
      Buffer.from([0, 0xff, 0x80, 0x41]),
    );
    expect(getAssetBuffer(assetFiles, '/bun.bin')).toEqual(
      Buffer.from([0, 0xff, 0x80, 0x41]),
    );
    expect(getAssetText(assetFiles, '/entry.js')).toBe('export default 1');
  });

  it('preserves canonical bytes across text and buffer reads', () => {
    const content = Buffer.from([0xff, 0x80, 0x41]);
    const assetFiles = { '/asset.bin': content };

    expect(getAssetText(assetFiles, '/asset.bin')).toBe('\ufffd\ufffdA');
    expect(getAssetBuffer(assetFiles, '/asset.bin')).toEqual(content);
    expect(assetFiles['/asset.bin']).toBe(content);
  });

  it('returns isolated buffers', () => {
    const content = Buffer.from([0, 0xff, 0x80, 0x41]);
    const assetFiles = { '/asset.bin': content };
    const first = getAssetBuffer(assetFiles, '/asset.bin');

    first[0] = 42;

    expect(getAssetBuffer(assetFiles, '/asset.bin')).toEqual(content);
    expect(assetFiles['/asset.bin']).toBe(content);
  });
});
