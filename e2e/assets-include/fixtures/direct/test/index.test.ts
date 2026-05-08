import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import assetPath from './message.txt';

const testDir = dirname(fileURLToPath(import.meta.url));

function readImportedAsset() {
  if (assetPath.startsWith('data:text/plain;base64,')) {
    return Buffer.from(
      assetPath.slice('data:text/plain;base64,'.length),
      'base64',
    )
      .toString('utf8')
      .trim();
  }

  const assetCandidates = [
    resolve(testDir, assetPath),
    resolve(testDir, '..', assetPath),
  ];

  for (const assetFile of assetCandidates) {
    if (existsSync(assetFile)) {
      return readFileSync(assetFile, 'utf8').trim();
    }
  }

  throw new Error(
    `Cannot resolve emitted asset for ${assetPath} from ${assetCandidates.join(', ')}`,
  );
}

it('should treat txt files as static assets', () => {
  expect(assetPath).toContain('text/plain');
  expect(readImportedAsset()).toBe('hello from rstest assetsInclude');
});
