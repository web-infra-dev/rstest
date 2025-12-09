import { describe, expect, it } from '@rstest/core';
import { BrowserSnapshotEnvironment } from '../../src/browser/client/snapshot';

describe('BrowserSnapshotEnvironment', () => {
  it('should create an instance', () => {
    const env = new BrowserSnapshotEnvironment();
    expect(env).toBeInstanceOf(BrowserSnapshotEnvironment);
  });

  it('should return version', () => {
    const env = new BrowserSnapshotEnvironment();
    expect(env.getVersion()).toBe('1');
  });

  it('should return header', () => {
    const env = new BrowserSnapshotEnvironment();
    expect(env.getHeader()).toBe('// Rstest Snapshot');
  });

  it('should resolve raw path', async () => {
    const env = new BrowserSnapshotEnvironment();
    const result = await env.resolveRawPath('/test/path', '/raw/path');
    expect(result).toBe('/raw/path');
  });

  it('should resolve path with .snap extension', async () => {
    const env = new BrowserSnapshotEnvironment();
    const result = await env.resolvePath('/test/file');
    expect(result).toBe('/test/file.snap');
  });

  it('should prepare directory without error', async () => {
    const env = new BrowserSnapshotEnvironment();
    await expect(env.prepareDirectory()).resolves.toBeUndefined();
  });

  describe('storage operations', () => {
    it('should save and read snapshot', async () => {
      const env = new BrowserSnapshotEnvironment();
      const filepath = '/test/snapshot.snap';
      const content = 'snapshot content';

      await env.saveSnapshotFile(filepath, content);
      const result = await env.readSnapshotFile(filepath);

      expect(result).toBe(content);
    });

    it('should return null for non-existent snapshot', async () => {
      const env = new BrowserSnapshotEnvironment();
      const result = await env.readSnapshotFile('/non-existent');

      expect(result).toBeNull();
    });

    it('should remove snapshot', async () => {
      const env = new BrowserSnapshotEnvironment();
      const filepath = '/test/snapshot.snap';

      await env.saveSnapshotFile(filepath, 'content');
      await env.removeSnapshotFile(filepath);
      const result = await env.readSnapshotFile(filepath);

      expect(result).toBeNull();
    });

    it('should handle multiple snapshots', async () => {
      const env = new BrowserSnapshotEnvironment();

      await env.saveSnapshotFile('/file1.snap', 'content1');
      await env.saveSnapshotFile('/file2.snap', 'content2');
      await env.saveSnapshotFile('/file3.snap', 'content3');

      expect(await env.readSnapshotFile('/file1.snap')).toBe('content1');
      expect(await env.readSnapshotFile('/file2.snap')).toBe('content2');
      expect(await env.readSnapshotFile('/file3.snap')).toBe('content3');
    });

    it('should overwrite existing snapshot', async () => {
      const env = new BrowserSnapshotEnvironment();
      const filepath = '/test/snapshot.snap';

      await env.saveSnapshotFile(filepath, 'original');
      await env.saveSnapshotFile(filepath, 'updated');
      const result = await env.readSnapshotFile(filepath);

      expect(result).toBe('updated');
    });
  });
});
