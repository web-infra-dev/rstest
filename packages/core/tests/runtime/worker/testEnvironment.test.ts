import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from '@rstest/core';
import { resolveTestEnvironmentPath } from '../../../src/core/resolveTestEnvironment';
import { loadTestEnvironment } from '../../../src/runtime/worker/testEnvironment';

const environmentModule = (name: string) =>
  [
    'export default {',
    `  name: '${name}',`,
    '  async setup() {',
    '    return {',
    '      async teardown() {},',
    '    };',
    '  },',
    '};',
  ].join('\n');

describe('testEnvironment', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
      tempDir = undefined;
    }
  });

  it('should continue resolving relative environment files across roots', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const firstRoot = join(tempDir, 'project-root');
    const secondRoot = join(tempDir, 'workspace-root');
    const environmentDir = join(secondRoot, 'fixtures');
    const environmentPath = join(environmentDir, 'custom-environment.mjs');

    mkdirSync(firstRoot, { recursive: true });
    mkdirSync(environmentDir, { recursive: true });
    writeFileSync(environmentPath, environmentModule('fallback-environment'));

    const resolvedPath = await resolveTestEnvironmentPath(
      './fixtures/custom-environment.mjs',
      [firstRoot, secondRoot],
    );
    const environment = await loadTestEnvironment(
      './fixtures/custom-environment.mjs',
      resolvedPath,
    );

    expect(resolvedPath).toBe(pathToFileURL(environmentPath).href);
    expect(environment.name).toBe('fallback-environment');
  });

  it('should continue resolving package candidates after invalid matches', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const firstPackageDir = join(tempDir, 'node_modules', 'package-marker');
    const fallbackPackageDir = join(
      tempDir,
      'node_modules',
      'rstest-environment-package-marker',
    );

    mkdirSync(firstPackageDir, { recursive: true });
    mkdirSync(fallbackPackageDir, { recursive: true });

    writeFileSync(
      join(firstPackageDir, 'package.json'),
      JSON.stringify({
        name: 'package-marker',
        type: 'module',
        exports: './index.mjs',
      }),
    );
    writeFileSync(
      join(firstPackageDir, 'index.mjs'),
      'export default { name: "not-an-environment" };',
    );

    writeFileSync(
      join(fallbackPackageDir, 'package.json'),
      JSON.stringify({
        name: 'rstest-environment-package-marker',
        type: 'module',
        exports: './index.mjs',
      }),
    );
    writeFileSync(
      join(fallbackPackageDir, 'index.mjs'),
      environmentModule('fallback-package-environment'),
    );

    const resolvedPath = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const environment = await loadTestEnvironment(
      'package-marker',
      resolvedPath,
    );

    expect(resolvedPath).toBe(
      pathToFileURL(
        join(
          realpathSync(tempDir),
          'node_modules',
          'rstest-environment-package-marker',
          'index.mjs',
        ),
      ).href,
    );
    expect(environment.name).toBe('fallback-package-environment');
  });

  it('should continue resolving package candidates after import failures', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const firstPackageDir = join(tempDir, 'node_modules', 'package-marker');
    const fallbackPackageDir = join(
      tempDir,
      'node_modules',
      'rstest-environment-package-marker',
    );

    mkdirSync(firstPackageDir, { recursive: true });
    mkdirSync(fallbackPackageDir, { recursive: true });

    writeFileSync(
      join(firstPackageDir, 'package.json'),
      JSON.stringify({
        name: 'package-marker',
        type: 'module',
        exports: './index.mjs',
      }),
    );
    writeFileSync(
      join(firstPackageDir, 'index.mjs'),
      'throw new Error("primary package import failed");',
    );

    writeFileSync(
      join(fallbackPackageDir, 'package.json'),
      JSON.stringify({
        name: 'rstest-environment-package-marker',
        type: 'module',
        exports: './index.mjs',
      }),
    );
    writeFileSync(
      join(fallbackPackageDir, 'index.mjs'),
      environmentModule('fallback-package-environment'),
    );

    const resolvedPath = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const environment = await loadTestEnvironment(
      'package-marker',
      resolvedPath,
    );

    expect(resolvedPath).toBe(
      pathToFileURL(
        join(
          realpathSync(tempDir),
          'node_modules',
          'rstest-environment-package-marker',
          'index.mjs',
        ),
      ).href,
    );
    expect(environment.name).toBe('fallback-package-environment');
  });

  it('should reject named environment exports before worker loading', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const environmentPath = join(tempDir, 'named-environment.mjs');

    writeFileSync(
      environmentPath,
      environmentModule('named-export-environment').replace(
        'export default',
        'export const environment =',
      ),
    );

    await expect(
      resolveTestEnvironmentPath('./named-environment.mjs', [
        realpathSync(tempDir),
      ]),
    ).rejects.toThrow(
      'must export a test environment object as the default export',
    );
  });
});
