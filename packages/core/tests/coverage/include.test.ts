import path from 'node:path';
import type { GlobOptions } from 'tinyglobby';
import { withDefaultConfig } from '../../src/config';
import { getIncludedFiles } from '../../src/coverage/generate';

describe('getIncludedFiles', () => {
  let defaultExclude: string[] = [];
  let memfs!: GlobOptions['fs'];
  beforeAll(async () => {
    const { fs } = await import('memfs');
    defaultExclude = withDefaultConfig({}).coverage.exclude;
    memfs = fs as any;

    // There's a bug in tinyglobby: if the computed common root path cannot be the root of the Windows volume, the root path will be resolved to pwd.
    [
      '/root/apps/a.ts',
      '/root/apps/b.js',
      '/root/apps/.c.ts',
      '/root/apps/node_modules/a.ts',
      '/root/apps/dist/a.ts',
      '/root/apps/test/a.ts',
      '/root/apps/__tests__/a.ts',
      '/root/apps/__mocks__/a.ts',
      '/root/apps/a.d.ts',
      '/root/apps/a.test.ts',
      '/root/apps/a.spec.ts',
      '/root/apps/a.test.js',
      '/root/apps/a.spec.js',
      '/root/apps/a.test.mts',
      '/root/apps/a.spec.mts',
      '/root/apps/a.test.cts',
      '/root/apps/a.spec.cts',
      '/root/apps/a.test.tsx',
      '/root/apps/a.spec.tsx',
      '/root/packages/a.ts',
      '/root/packages/b.js',
      '/root/packages/.c.ts',
    ].forEach((file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
    });
  });

  const glob = async (include: string[], exclude: string[] = []) => {
    const files = await getIncludedFiles(
      {
        include,
        exclude: [...defaultExclude, ...exclude],
      },
      '/root/apps',
      memfs,
    );
    // ensure consistent paths across platforms
    return files
      .map((file) => path.relative('/root', file).replaceAll(path.sep, '/'))
      .sort();
  };

  it('should include visible files by default', async () => {
    expect(
      await glob(['**/*.{js,ts}', '../packages/*.{js,ts}']),
    ).toMatchInlineSnapshot(`
      [
        "apps/a.ts",
        "apps/b.js",
        "packages/a.ts",
        "packages/b.js",
      ]
    `);
  });

  it('should include hidden files if explicitly specified', async () => {
    expect(await glob(['**/*.{js,ts}', '**/.c.ts'])).toMatchInlineSnapshot(`
      [
        "apps/.c.ts",
        "apps/a.ts",
        "apps/b.js",
      ]
    `);
  });

  it('should exclude node_modules, dist, test, __tests__, __mocks__ by default', async () => {
    expect(await glob(['**/*'])).toMatchInlineSnapshot(`
      [
        "apps/a.ts",
        "apps/b.js",
      ]
    `);
  });

  it('should exclude .d.ts files by default', async () => {
    expect(await glob(['**/*.d.ts'])).toMatchInlineSnapshot('[]');
  });

  it('should exclude test and spec files by default', async () => {
    expect(await glob(['**/*.{test,spec}.*'])).toMatchInlineSnapshot('[]');
  });
});
