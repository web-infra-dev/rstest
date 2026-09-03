import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';

// This helper must stay dependency-free CommonJS so Node can run it before install.
const { ensureIcon } = require('../../scripts/ensureIcon.cjs') as {
  ensureIcon(options: {
    path: string;
    url: string;
    fetchIcon: () => Promise<{
      ok: boolean;
      status: number;
      statusText: string;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>;
  }): Promise<boolean>;
};

describe('ensureIcon', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'rstest-vscode-icon-'));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it('does not download an existing icon', async () => {
    const path = join(tempDir, 'icon.png');
    await writeFile(path, 'existing icon');

    const downloaded = await ensureIcon({
      path,
      url: 'https://example.com/icon.png',
      fetchIcon: () => {
        throw new Error('unexpected download');
      },
    });

    expect(downloaded).toBe(false);
    await expect(readFile(path, 'utf8')).resolves.toBe('existing icon');
  });

  it('downloads a missing icon', async () => {
    const path = join(tempDir, 'icon.png');
    const content = new TextEncoder().encode('downloaded icon');

    const downloaded = await ensureIcon({
      path,
      url: 'https://example.com/icon.png',
      fetchIcon: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => content.buffer,
      }),
    });

    expect(downloaded).toBe(true);
    await expect(readFile(path, 'utf8')).resolves.toBe('downloaded icon');
  });
});
