import { describe, expect, it } from '@rstest/core';
import { blobFileName, isBlobFile } from '../../src/reporter/blob';

describe('blob wire-format', () => {
  it('names the unsharded blob deterministically', () => {
    expect(blobFileName()).toBe('blob.json');
    expect(blobFileName(undefined)).toBe('blob.json');
  });

  it('encodes the shard index/count into the filename', () => {
    expect(blobFileName({ index: 1, count: 4 })).toBe('blob-1-4.json');
    expect(blobFileName({ index: 12, count: 30 })).toBe('blob-12-30.json');
  });

  it('round-trips: every name the writer emits is recognized by the reader', () => {
    expect(isBlobFile(blobFileName())).toBe(true);
    expect(isBlobFile(blobFileName({ index: 2, count: 3 }))).toBe(true);
  });

  it('rejects unrelated and malformed filenames', () => {
    expect(isBlobFile('blob.txt')).toBe(false);
    expect(isBlobFile('report.json')).toBe(false);
    expect(isBlobFile('blob-1.json')).toBe(false);
    expect(isBlobFile('blob-1-2-3.json')).toBe(false);
    expect(isBlobFile('prefix-blob.json')).toBe(false);
    expect(isBlobFile('blob-a-b.json')).toBe(false);
  });
});
