import { describe, expect, it } from '@rstest/core';
import {
  createBrowserContextExcludeRegExp,
  toContextKey,
} from '../src/browserRsbuild';

describe('browser config resolution', () => {
  it('should derive the non-watch import-map key like the runtime toContextKey', () => {
    // Keys must match the browser runtime's `toContextKey` so `loadTest(key)`
    // resolves against the manifest import map.
    expect(toContextKey('/project/tests/a.test.ts', '/project')).toBe(
      './tests/a.test.ts',
    );
    // Paths outside the project root keep their absolute form so the runtime
    // `toAbsolutePath` round-trips them instead of re-rooting under projectRoot.
    expect(toContextKey('/elsewhere/x.test.ts', '/project')).toBe(
      '/elsewhere/x.test.ts',
    );
    // A sibling that only shares a string prefix with the root is not stripped
    // at a non-boundary (would otherwise mangle to `./-extra/a.test.ts`); it is
    // outside the root, so it is also kept absolute.
    expect(toContextKey('/repo/pkg-extra/a.test.ts', '/repo/pkg')).toBe(
      '/repo/pkg-extra/a.test.ts',
    );
  });

  it('should keep leading dots in browser context exclude patterns', () => {
    const exclude = createBrowserContextExcludeRegExp(
      [
        '**/node_modules/**',
        '**/dist/**',
        '**/.{idea,git,cache,output,temp}/**',
      ],
      '/repo/git/project',
    );

    expect(exclude?.test('/repo/git/project/tests/example.test.ts')).toBe(
      false,
    );
    expect(exclude?.test('/repo/git/project-other/.git/config')).toBe(false);
    expect(exclude?.test('/repo/git/project/.git/config')).toBe(true);
    expect(exclude?.test('/repo/git/project/.cache/output.js')).toBe(true);
    expect(exclude?.test('/repo/git/project/cache/output.js')).toBe(false);
    expect(exclude?.test('/repo/git/project/node_modules/pkg/index.js')).toBe(
      true,
    );
    expect(exclude?.test('tests/example.test.ts')).toBe(false);
    expect(exclude?.test('.git/config')).toBe(true);
    expect(exclude?.test('./.git/config')).toBe(true);
    expect(exclude?.test('./node_modules/pkg/index.js')).toBe(true);
  });

  it('should apply absolute browser context exclude patterns from project root', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['**/.{idea,git,cache,output,temp}/**'],
      '/tmp/.cache/app',
    );

    expect(exclude?.test('/tmp/.cache/app/tests/example.test.ts')).toBe(false);
    expect(exclude?.test('/tmp/.cache/app/.cache/output.js')).toBe(true);
    expect(exclude?.test('tests/example.test.ts')).toBe(false);
    expect(exclude?.test('.cache/output.js')).toBe(true);
    expect(exclude?.test('./.cache/output.js')).toBe(true);
  });

  it('should match dot-prefixed browser context exclude patterns', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['./fixtures/**'],
      '/repo/project',
    );

    expect(exclude?.test('./fixtures/example.test.ts')).toBe(true);
    expect(exclude?.test('.\\fixtures\\example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/fixtures/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/src/fixtures/example.test.ts')).toBe(
      false,
    );
    expect(exclude?.test('fixtures/example.test.ts')).toBe(false);
    expect(exclude?.test('./src/fixtures/example.test.ts')).toBe(false);
  });

  it('should match non-globstar relative browser context exclude patterns with ./ prefixes', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['dist/**'],
      '/repo/project',
    );

    expect(exclude?.test('dist/example.test.ts')).toBe(true);
    expect(exclude?.test('./dist/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/dist/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/src/dist/example.test.ts')).toBe(false);
  });

  it('should match dot-prefixed browser context exclude patterns on Windows absolute paths', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['./fixtures/**'],
      'C:\\repo\\project',
    );

    expect(exclude?.test('C:\\repo\\project\\fixtures\\example.test.ts')).toBe(
      true,
    );
    expect(
      exclude?.test('C:\\repo\\project\\src\\fixtures\\example.test.ts'),
    ).toBe(false);
    expect(exclude?.test('.\\fixtures\\example.test.ts')).toBe(true);
  });

  it('should not prefix POSIX absolute browser context exclude patterns twice', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['/repo/project/fixtures/**'],
      '/repo/project',
    );

    expect(exclude?.test('/repo/project/fixtures/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/src/fixtures/example.test.ts')).toBe(
      false,
    );
    expect(
      exclude?.test('/repo/project/repo/project/fixtures/example.test.ts'),
    ).toBe(false);
    expect(exclude?.test('./fixtures/example.test.ts')).toBe(false);
  });

  it('should not prefix Windows absolute browser context exclude patterns twice', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['C:\\repo\\project\\fixtures\\**'],
      'C:\\repo\\project',
    );

    expect(exclude?.test('C:\\repo\\project\\fixtures\\example.test.ts')).toBe(
      true,
    );
    expect(
      exclude?.test('C:\\repo\\project\\src\\fixtures\\example.test.ts'),
    ).toBe(false);
    expect(
      exclude?.test(
        'C:\\repo\\project\\C:\\repo\\project\\fixtures\\example.test.ts',
      ),
    ).toBe(false);
    expect(exclude?.test('.\\fixtures\\example.test.ts')).toBe(false);
  });

  it('should scope Windows absolute browser context exclude patterns to project root', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['**/dist/**'],
      'C:\\repo\\dist\\project',
    );

    expect(
      exclude?.test('C:\\repo\\dist\\project\\tests\\example.test.ts'),
    ).toBe(false);
    expect(exclude?.test('C:\\repo\\dist\\project\\dist\\output.js')).toBe(
      true,
    );
    expect(
      exclude?.test('C:\\repo\\dist\\project-other\\dist\\output.js'),
    ).toBe(false);
    expect(exclude?.test('dist\\output.js')).toBe(true);
  });

  it('should apply hidden-dir browser context exclude patterns on Windows paths', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['**/.{idea,git,cache,output,temp}/**'],
      'C:\\tmp\\.cache\\app',
    );

    expect(exclude?.test('C:\\tmp\\.cache\\app\\tests\\example.test.ts')).toBe(
      false,
    );
    expect(exclude?.test('C:\\tmp\\.cache\\app\\.cache\\output.js')).toBe(true);
  });

  it('should match hidden files under browser context exclude patterns', () => {
    const exclude = createBrowserContextExcludeRegExp(
      ['**/dist/**'],
      '/repo/project',
    );

    expect(exclude?.test('./dist/.fixtures/example.test.ts')).toBe(true);
    expect(exclude?.test('/repo/project/dist/.fixtures/example.test.ts')).toBe(
      true,
    );
    expect(exclude?.test('.dist/.fixtures/example.test.ts')).toBe(false);
    expect(exclude?.test('./src/.fixtures/example.test.ts')).toBe(false);
  });
});
