import { once } from 'node:events';
import zlib from 'node:zlib';
import { describe, expect, it } from '@rstest/core';

describe('async leak', () => {
  it('does not report a closed zlib stream as a leak', async () => {
    const gzip = zlib.createGzip();
    const chunks: Buffer[] = [];

    gzip.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    gzip.end('hello '.repeat(300));

    await once(gzip, 'close');

    expect(chunks.length).toBeGreaterThan(0);
  });
});
