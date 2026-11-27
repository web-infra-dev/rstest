import { constants } from 'node:zlib';
import { PNG } from 'pngjs';

// Group adjacent occupied tiles so the outline surrounds a word or control,
// rather than drawing a separate box around each glyph.
const tileSize = 16;
const violet = 0x7838d6ff;
const strokeColors = [0xffffffff, violet, violet];
const tint = [violet >>> 24, (violet >>> 16) & 255, (violet >>> 8) & 255];

function drawOutline(
  image: PNG,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  // The white outer stroke keeps the violet outline visible on dark content.
  for (const [inset, color] of strokeColors.entries()) {
    const x1 = left + inset;
    const x2 = right - inset;
    const y1 = top + inset;
    const y2 = bottom - inset;
    if (x1 > x2 || y1 > y2) break;
    for (let x = x1; x <= x2; x++) {
      image.data.writeUInt32BE(color, (y1 * image.width + x) * 4);
      image.data.writeUInt32BE(color, (y2 * image.width + x) * 4);
    }
    for (let y = y1; y <= y2; y++) {
      image.data.writeUInt32BE(color, (y * image.width + x1) * 4);
      image.data.writeUInt32BE(color, (y * image.width + x2) * 4);
    }
  }
}

function markLargeRegion(
  image: PNG,
  tiles: number[],
  rowMasks: Uint16Array,
  columns: number,
  gutterRows: Uint8Array,
): void {
  for (const tile of tiles) {
    const left = (tile % columns) * tileSize;
    const right = Math.min(left + tileSize, image.width);
    const top = Math.floor(tile / columns) * tileSize;
    // Tint nearby changed pixel rows together to keep text legible. The gutter
    // marks only rows that contain a changed pixel.
    let previous = -tileSize;
    for (let dy = 0; dy < tileSize; dy++) {
      if (!(rowMasks[tile]! & (1 << dy))) continue;
      gutterRows[top + dy] = 1;
      const from = dy - previous <= 3 ? previous + 1 : dy;
      previous = dy;
      for (let y = top + from; y <= top + dy; y++) {
        for (let x = left; x < right; x++) {
          const offset = (y * image.width + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            const i = offset + channel;
            image.data[i] = Math.round(
              (9 * image.data[i]! + tint[channel]!) / 10,
            );
          }
        }
      }
    }
  }
}

export const createRegionDiff = (
  actual: PNG,
  pixelDiff: PNG,
): Buffer | undefined => {
  const { width, height } = actual;
  if (Math.min(width, height) <= 2 * strokeColors.length) return undefined;
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  // Each bit represents one pixel row in the tile.
  const rowMasks = new Uint16Array(columns * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / tileSize) * columns;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // pixelmatch paints counted pixels red; its yellow AA markers and
      // grayscale context must not enlarge a region.
      if (
        pixelDiff.data[i] === 255 &&
        pixelDiff.data[i + 1] === 0 &&
        pixelDiff.data[i + 2] === 0
      ) {
        const tile = row + Math.floor(x / tileSize);
        rowMasks[tile] = rowMasks[tile]! | (1 << (y % tileSize));
      }
    }
  }

  const result = new PNG({ width, height });
  actual.data.copy(result.data);
  const visited = new Uint8Array(rowMasks.length);
  const gutterRows = new Uint8Array(height);
  for (let seed = 0; seed < rowMasks.length; seed++) {
    if (!rowMasks[seed] || visited[seed]) continue;
    visited[seed] = 1;
    const tiles = [seed];
    let left = columns;
    let top = rows;
    let right = 0;
    let bottom = 0;
    for (const tile of tiles) {
      const x = tile % columns;
      const y = Math.floor(tile / columns);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (let ty = Math.max(0, y - 1); ty <= Math.min(rows - 1, y + 1); ty++) {
        for (
          let tx = Math.max(0, x - 1);
          tx <= Math.min(columns - 1, x + 1);
          tx++
        ) {
          const neighbor = ty * columns + tx;
          if (rowMasks[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            tiles.push(neighbor);
          }
        }
      }
    }
    // Tight boxes work for labels and buttons. Once both spans reach eight
    // tiles, show the changes inside the box instead of outlining its extent.
    if (Math.min(right - left + 1, bottom - top + 1) >= 8) {
      markLargeRegion(result, tiles, rowMasks, columns, gutterRows);
      continue;
    }
    drawOutline(
      result,
      Math.max(0, left * tileSize - 3),
      Math.max(0, top * tileSize - 3),
      Math.min(width - 1, (right + 1) * tileSize + 2),
      Math.min(height - 1, (bottom + 1) * tileSize + 2),
    );
  }
  // A high-contrast gutter stays visible even when the top and bottom of a
  // large region are outside the scrolled comparison.
  for (let y = 0; y < height; y++) {
    if (!gutterRows[y]) continue;
    const start = y * width * 4;
    result.data.writeUInt32BE(0xffffffff, start);
    for (let x = 1; x <= 6; x++) {
      result.data.writeUInt32BE(violet, start + x * 4);
    }
    result.data.writeUInt32BE(0xffffffff, start + 7 * 4);
  }
  return PNG.sync.write(result, {
    deflateStrategy: constants.Z_DEFAULT_STRATEGY,
    deflateLevel: 6,
  });
};
