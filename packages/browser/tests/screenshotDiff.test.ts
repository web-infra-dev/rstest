import { expect, it } from '@rstest/core';
import { PNG } from 'pngjs';
import { createRegionDiff } from '../src/screenshotDiff';

it('outlines counted changes while preserving the actual pixels and ignoring AA markers', () => {
  const width = 128;
  const height = 64;
  const actual = new PNG({ width, height });
  actual.data.fill(Buffer.from([20, 80, 180, 200]));
  const diff = new PNG({ width, height });
  const change = (32 * width + 26) * 4;
  const antiAlias = (32 * width + 96) * 4;
  diff.data.writeUInt32BE(0xff0000ff, change);
  diff.data.writeUInt32BE(0xffff00ff, antiAlias);

  const marked = PNG.sync.read(createRegionDiff(actual, diff)!);
  expect(marked.data.readUInt32BE(change)).toBe(
    actual.data.readUInt32BE(change),
  );
  let outlinePixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (
        marked.data.readUInt32BE(offset) !== actual.data.readUInt32BE(offset)
      ) {
        expect(x).toBeLessThan(width / 2);
        outlinePixels++;
      }
    }
  }
  expect(outlinePixels).toBeGreaterThan(0);
});

it('falls back to the pixel map when the outline would cover the image', () => {
  const image = new PNG({ width: 32, height: 1 });
  expect(createRegionDiff(image, image)).toBeUndefined();
});

it('marks changed rows inside a large region without coloring the empty space between them', () => {
  const actual = new PNG({ width: 149, height: 145 });
  const original = 0xeee6da99;
  actual.data.fill(Buffer.from([0xee, 0xe6, 0xda, 0x99]));
  const diff = new PNG({ width: actual.width, height: actual.height });
  const offset = (x: number, y: number) => (y * actual.width + x) * 4;
  for (let tile = 0; tile < 9; tile++) {
    diff.data.writeUInt32BE(0xff0000ff, offset(16 * tile + 5, 16 * tile + 15));
  }
  diff.data.writeUInt32BE(0xffff00ff, offset(69, 80));

  const marked = PNG.sync.read(createRegionDiff(actual, diff)!);
  const color = (x: number, y: number) =>
    marked.data.readUInt32BE(offset(x, y));
  expect(color(3, 79)).toBe(0x7838d6ff);
  expect(color(69, 79)).not.toBe(original);
  expect(marked.data[offset(69, 79) + 3]).toBe(0x99);
  expect(color(100, 79)).toBe(original);
  expect(color(3, 80)).toBe(original);
  expect(color(69, 80)).toBe(original);
  expect(color(3, 143)).toBe(0x7838d6ff);
});
