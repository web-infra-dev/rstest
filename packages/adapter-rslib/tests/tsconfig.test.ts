import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { loadTsconfig } from '../src/tsconfig';

const fixtureDir = join(__dirname, 'fixtures/tsconfig');

describe('loadTsconfig', () => {
  it('should load tsconfig files', async () => {
    const defaultTsconfig = await loadTsconfig(fixtureDir);
    const customTsconfig = await loadTsconfig(
      fixtureDir,
      './tsconfig.custom.json',
    );
    const absoluteTsconfig = await loadTsconfig(
      fixtureDir,
      join(fixtureDir, 'tsconfig.custom.json'),
    );

    expect(defaultTsconfig).toEqual({
      compilerOptions: {
        rootDir: './',
      },
    });
    expect(customTsconfig).toEqual({
      compilerOptions: {
        rootDir: './custom',
      },
    });
    expect(absoluteTsconfig).toEqual(customTsconfig);
  });

  it('should return an empty object when the path is not a file', async () => {
    await expect(
      loadTsconfig(fixtureDir, 'non-existent.json'),
    ).resolves.toEqual({});
    await expect(loadTsconfig(fixtureDir, '.')).resolves.toEqual({});
  });
});
