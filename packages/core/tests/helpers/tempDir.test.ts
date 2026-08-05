import { existsSync } from 'node:fs';
import { describe, expect, it } from '@rstest/core';
import { withTempDir } from './tempDir';

describe('withTempDir', () => {
  it('removes the directory after successful completion', async () => {
    let directory = '';

    await withTempDir('rstest-helper-success-', (tempDirectory) => {
      directory = tempDirectory;
      expect(existsSync(directory)).toBe(true);
    });

    expect(existsSync(directory)).toBe(false);
  });

  it('removes the directory and propagates callback rejection', async () => {
    const error = new Error('callback failed');
    let directory = '';

    await expect(
      withTempDir('rstest-helper-rejection-', (tempDirectory) => {
        directory = tempDirectory;
        throw error;
      }),
    ).rejects.toBe(error);

    expect(existsSync(directory)).toBe(false);
  });
});
