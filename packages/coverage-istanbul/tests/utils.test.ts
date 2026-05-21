import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import istanbulCoverage from 'istanbul-lib-coverage';
import { getSourceMappingURL, transformCoverage } from '../src/utils';

describe('coverage istanbul utils', () => {
  it('extracts the last sourceMappingURL without splitting the whole file', () => {
    const code = [
      'const sourceMappingURL = "not a comment";',
      '//# sourceMappingURL=first.js.map',
      'console.log("hello");',
      '//# sourceMappingURL=second.js.map',
    ].join('\n');

    expect(getSourceMappingURL(code)).toBe('second.js.map');
  });

  it('returns undefined when sourceMappingURL only appears outside comments', () => {
    expect(getSourceMappingURL('const sourceMappingURL = "inline";')).toBe(
      undefined,
    );
  });

  it('does not reread files whose sourcemap cache entry is already undefined', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rstest-coverage-cache-'));
    const file = path.join(root, 'index.js');
    writeFileSync(file, 'export const value = 1;\n');

    const coverageMap = istanbulCoverage.createCoverageMap({
      [file]: {
        path: file,
        statementMap: {},
        fnMap: {},
        branchMap: {},
        s: {},
        f: {},
        b: {},
      },
    });
    const sourcemapUrlCache = new Map<string, string | undefined>([
      [file, undefined],
    ]);

    try {
      rmSync(file);
      await expect(
        transformCoverage(coverageMap, sourcemapUrlCache),
      ).resolves.toBe(coverageMap);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
