import { describe, expect, it } from '@rstest/core';

// TODO: win32 path
describe.runIf(process.platform !== 'win32')('current URL', () => {
  describe('module paths', async () => {
    it('import.meta.filename to equal __dirname', () => {
      expect(import.meta.filename).toBe(__filename);
    });

    it('import.meta.filename to equal __dirname', () => {
      expect(import.meta.dirname).toBe(__dirname);
    });

    it('__filename', () => {
      expect(__filename.startsWith('file://')).toBe(false);
      expect(
        __filename.endsWith('/rstest/tests/basic/test/filePath.test.ts'),
      ).toBe(true);
    });

    it('__dirname', () => {
      expect(__dirname.startsWith('file://')).toBe(false);
      expect(__dirname.endsWith('/rstest/tests/basic/test')).toBe(true);
    });

    it('import.meta.url', () => {
      expect(import.meta.url.startsWith('file://')).toBe(true);
      expect(
        import.meta.url.endsWith('/rstest/tests/basic/test/filePath.test.ts'),
      ).toBe(true);
    });
  });
});
