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

const createPackage = (root: string, name: string, source: string) => {
  const packageDir = join(root, 'node_modules', name);

  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name,
      type: 'module',
      exports: './index.mjs',
    }),
  );
  writeFileSync(join(packageDir, 'index.mjs'), source);
};

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

    createPackage(
      tempDir,
      'package-marker',
      'export default { name: "not-an-environment" };',
    );
    createPackage(
      tempDir,
      'rstest-environment-package-marker',
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

    createPackage(
      tempDir,
      'package-marker',
      'throw new Error("primary package import failed");',
    );
    createPackage(
      tempDir,
      'rstest-environment-package-marker',
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

  it('should surface import errors when all package candidates fail to import', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    createPackage(
      tempDir,
      'package-marker',
      'throw new Error("primary package import failed");',
    );
    createPackage(
      tempDir,
      'rstest-environment-package-marker',
      'throw new Error("fallback package import failed");',
    );

    const promise = resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);

    await expect(promise).rejects.toThrow('fallback package import failed');
    await expect(promise).rejects.toHaveProperty(
      'cause.message',
      'fallback package import failed',
    );
  });

  it('should reject package modules without a default environment export', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    createPackage(
      tempDir,
      'package-marker',
      [
        'export const name = "named-export-environment";',
        'export const setup = async () => ({',
        '  async teardown() {},',
        '});',
      ].join('\n'),
    );

    await expect(
      resolveTestEnvironmentPath('package-marker', [realpathSync(tempDir)]),
    ).rejects.toThrow(
      'must export a test environment object as the default export',
    );
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
