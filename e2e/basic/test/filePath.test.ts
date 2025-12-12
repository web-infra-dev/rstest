import { describe, expect, it } from '@rstest/core';
import pathe from 'pathe';

describe('current URL', () => {
  describe('module paths', async () => {
    it('import.meta.dirname to equal __dirname', () => {
      expect(import.meta.dirname).toBe(__dirname);
    });

    it('import.meta.filename to equal __filename', () => {
      expect(import.meta.filename).toBe(__filename);
    });

    it('__filename', () => {
      expect(__filename.startsWith('file://')).toBe(false);
      expect(
        pathe
          .normalize(__filename)
          .endsWith('/e2e/basic/test/filePath.test.ts'),
      ).toBe(true);
    });

    it('__dirname', () => {
      expect(__dirname.startsWith('file://')).toBe(false);
      expect(pathe.normalize(__dirname).endsWith('/e2e/basic/test')).toBe(true);
    });

    it('import.meta.url', () => {
      expect(import.meta.url.startsWith('file://')).toBe(true);
      expect(import.meta.url.endsWith('/e2e/basic/test/filePath.test.ts')).toBe(
        true,
      );
    });
  });
});
