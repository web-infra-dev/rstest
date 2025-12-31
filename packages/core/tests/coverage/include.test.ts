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

    [
      '/apps/a.ts',
      '/apps/b.js',
      '/apps/.c.ts',
      '/apps/node_modules/a.ts',
      '/apps/dist/a.ts',
      '/apps/test/a.ts',
      '/apps/__tests__/a.ts',
      '/apps/__mocks__/a.ts',
      '/apps/a.d.ts',
      '/apps/a.test.ts',
      '/apps/a.spec.ts',
      '/apps/a.test.js',
      '/apps/a.spec.js',
      '/apps/a.test.mts',
      '/apps/a.spec.mts',
      '/apps/a.test.cts',
      '/apps/a.spec.cts',
      '/apps/a.test.tsx',
      '/apps/a.spec.tsx',
      '/packages/a.ts',
      '/packages/b.js',
      '/packages/.c.ts',
    ].forEach((file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
    });
  });

  it('should include visible files by default', async () => {
    expect(
      await getIncludedFiles(
        {
          include: ['**/*.{js,ts}', '../packages/*.{js,ts}'],
          exclude: [...defaultExclude],
        },
        '/apps',
        memfs,
      ),
    ).toMatchInlineSnapshot(`
      [
        "/apps/a.ts",
        "/apps/b.js",
        "/packages/a.ts",
        "/packages/b.js",
      ]
    `);
  });

  it('should include hidden files if explicitly specified', async () => {
    expect(
      await getIncludedFiles(
        {
          include: ['**/*.{js,ts}', '**/.c.ts'],
          exclude: [...defaultExclude],
        },
        '/apps',
        memfs,
      ),
    ).toMatchInlineSnapshot(`
      [
        "/apps/.c.ts",
        "/apps/a.ts",
        "/apps/b.js",
      ]
    `);
  });

  it('should exclude node_modules, dist, test, __tests__, __mocks__ by default', async () => {
    expect(
      await getIncludedFiles(
        {
          include: ['**/*'],
          exclude: [...defaultExclude],
        },
        '/apps',
        memfs,
      ),
    ).toMatchInlineSnapshot(`
      [
        "/apps/a.ts",
        "/apps/b.js",
      ]
    `);
  });

  it('should exclude .d.ts files by default', async () => {
    expect(
      await getIncludedFiles(
        {
          include: ['**/*.d.ts'],
          exclude: [...defaultExclude],
        },
        '/apps',
        memfs,
      ),
    ).toMatchInlineSnapshot('[]');
  });

  it('should exclude test and spec files by default', async () => {
    expect(
      await getIncludedFiles(
        {
          include: ['**/*.{test,spec}.*'],
          exclude: [...defaultExclude],
        },
        '/apps',
        memfs,
      ),
    ).toMatchInlineSnapshot('[]');
  });
});
