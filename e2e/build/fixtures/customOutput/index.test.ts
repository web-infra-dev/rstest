import { describe, expect, it } from '@rstest/core';

describe('custom output', () => {
  it('runs successfully', () => {
    const outputDir = process.env.RSTEST_PERMISSION_OUTPUT_DIR;
    if (outputDir) {
      expect(process.permission?.has('fs.read', outputDir)).toBe(false);
    }
    expect(1 + 1).toBe(2);
  });
});
