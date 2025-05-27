import { describe, expect, it } from '@rstest/core';
import { slash } from '../../scripts/utils';

describe('current URL', () => {
  // TODO: Support import.meta.url and import.meta.dirname
  // expect import.meta.filename to equal __filename
  // expect import.meta.dirname to equal __dirname

  describe('module paths', async () => {
    it('__filename', () => {
      expect(__filename.startsWith('file://')).toBe(false);
      expect(
        slash(__filename).endsWith('/rstest/tests/basic/test/filePath.test.ts'),
      ).toBe(true);
    });

    it('__dirname', () => {
      expect(__dirname.startsWith('file://')).toBe(false);
      expect(slash(__dirname).endsWith('/rstest/tests/basic/test')).toBe(true);
    });

    it('import.meta.url', () => {
      expect(import.meta.url.startsWith('file://')).toBe(true);
      expect(
        slash(import.meta.url).endsWith(
          '/rstest/tests/basic/test/filePath.test.ts',
        ),
      ).toBe(true);
    });
  });
});
