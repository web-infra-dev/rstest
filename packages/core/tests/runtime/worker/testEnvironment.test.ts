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

const controllerImportMarker = '__RSTEST_CONTROLLER_ENV_IMPORT_COUNT__';

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

const packageEnvironmentPath = (
  root: string,
  name: string,
  file = 'index.mjs',
) => pathToFileURL(join(realpathSync(root), 'node_modules', name, file)).href;

describe('testEnvironment', () => {
  let tempDir: string | undefined;
  let sourcePackageDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
      tempDir = undefined;
    }
    if (sourcePackageDir) {
      rmSync(sourcePackageDir, { force: true, recursive: true });
      sourcePackageDir = undefined;
    }
    Reflect.deleteProperty(globalThis, controllerImportMarker);
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

    const resolvedPaths = await resolveTestEnvironmentPath(
      './fixtures/custom-environment.mjs',
      [firstRoot, secondRoot],
    );
    const environment = await loadTestEnvironment(
      './fixtures/custom-environment.mjs',
      resolvedPaths,
    );

    expect(resolvedPaths).toEqual([pathToFileURL(environmentPath).href]);
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

    const resolvedPaths = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const environment = await loadTestEnvironment(
      'package-marker',
      resolvedPaths,
    );

    expect(resolvedPaths).toEqual([
      packageEnvironmentPath(tempDir, 'package-marker'),
      packageEnvironmentPath(tempDir, 'rstest-environment-package-marker'),
    ]);
    expect(environment.name).toBe('fallback-package-environment');
  });

  it('should resolve package environments from configured roots before source tree packages', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));
    sourcePackageDir = join(
      process.cwd(),
      'packages/core/src/core/node_modules/package-marker',
    );

    mkdirSync(sourcePackageDir, { recursive: true });
    writeFileSync(
      join(sourcePackageDir, 'package.json'),
      JSON.stringify({
        name: 'package-marker',
        type: 'module',
        exports: './index.mjs',
      }),
    );
    writeFileSync(
      join(sourcePackageDir, 'index.mjs'),
      'export default { name: "source-tree-package" };',
    );
    createPackage(
      tempDir,
      'package-marker',
      environmentModule('configured-root-package'),
    );

    const resolvedPaths = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const environment = await loadTestEnvironment(
      'package-marker',
      resolvedPaths,
    );

    expect(resolvedPaths).toEqual([
      packageEnvironmentPath(tempDir, 'package-marker'),
    ]);
    expect(environment.name).toBe('configured-root-package');
  });

  it('should prefer node export conditions over default conditions', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const packageDir = join(tempDir, 'node_modules', 'package-marker');

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'package-marker',
        type: 'module',
        exports: {
          '.': {
            node: './node.mjs',
            default: './browser.mjs',
          },
        },
      }),
    );
    writeFileSync(
      join(packageDir, 'node.mjs'),
      environmentModule('node-entry'),
    );
    writeFileSync(
      join(packageDir, 'browser.mjs'),
      environmentModule('browser-entry'),
    );

    const resolvedPaths = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const environment = await loadTestEnvironment(
      'package-marker',
      resolvedPaths,
    );

    expect(resolvedPaths).toEqual([
      packageEnvironmentPath(tempDir, 'package-marker', 'node.mjs'),
    ]);
    expect(environment.name).toBe('node-entry');
  });

  it('should resolve main before module when exports is absent', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const packageDir = join(tempDir, 'node_modules', 'package-marker');

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'package-marker',
        type: 'module',
        main: './node.mjs',
        module: './browser.mjs',
      }),
    );
    writeFileSync(
      join(packageDir, 'node.mjs'),
      environmentModule('node-entry'),
    );
    writeFileSync(
      join(packageDir, 'browser.mjs'),
      environmentModule('browser-entry'),
    );

    const resolvedPaths = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const environment = await loadTestEnvironment(
      'package-marker',
      resolvedPaths,
    );

    expect(resolvedPaths).toEqual([
      packageEnvironmentPath(tempDir, 'package-marker', 'node.mjs'),
    ]);
    expect(environment.name).toBe('node-entry');
  });

  it('should not select require export conditions for imported environments', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const packageDir = join(tempDir, 'node_modules', 'package-marker');

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'package-marker',
        type: 'module',
        exports: {
          '.': {
            require: './require.cjs',
            import: './import.mjs',
          },
        },
      }),
    );
    writeFileSync(join(packageDir, 'require.cjs'), 'module.exports = {};');
    writeFileSync(
      join(packageDir, 'import.mjs'),
      environmentModule('import-entry'),
    );

    const resolvedPaths = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const environment = await loadTestEnvironment(
      'package-marker',
      resolvedPaths,
    );

    expect(resolvedPaths).toEqual([
      packageEnvironmentPath(tempDir, 'package-marker', 'import.mjs'),
    ]);
    expect(environment.name).toBe('import-entry');
  });

  it('should not import environment modules while resolving paths', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const environmentPath = join(tempDir, 'side-effect-environment.mjs');

    writeFileSync(
      environmentPath,
      [
        `globalThis.${controllerImportMarker} =`,
        `  (globalThis.${controllerImportMarker} ?? 0) + 1;`,
        environmentModule('side-effect-environment'),
      ].join('\n'),
    );

    const resolvedPaths = await resolveTestEnvironmentPath(
      './side-effect-environment.mjs',
      [realpathSync(tempDir)],
    );

    expect(resolvedPaths).toEqual([
      pathToFileURL(realpathSync(environmentPath)).href,
    ]);
    expect(Reflect.get(globalThis, controllerImportMarker)).toBeUndefined();

    const environment = await loadTestEnvironment(
      './side-effect-environment.mjs',
      resolvedPaths,
    );

    expect(environment.name).toBe('side-effect-environment');
    expect(Reflect.get(globalThis, controllerImportMarker)).toBe(1);
  });

  it('should unwrap transpiled CommonJS default environment exports', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const environmentPath = join(tempDir, 'cjs-environment.cjs');

    writeFileSync(
      environmentPath,
      [
        'module.exports = {',
        '  __esModule: true,',
        '  default: {',
        '    name: "cjs-default-environment",',
        '    async setup() {',
        '      return { async teardown() {} };',
        '    },',
        '  },',
        '};',
      ].join('\n'),
    );

    const environment = await loadTestEnvironment('./cjs-environment.cjs', [
      pathToFileURL(environmentPath).href,
    ]);

    expect(environment.name).toBe('cjs-default-environment');
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

    const resolvedPaths = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const environment = await loadTestEnvironment(
      'package-marker',
      resolvedPaths,
    );

    expect(resolvedPaths).toEqual([
      packageEnvironmentPath(tempDir, 'package-marker'),
      packageEnvironmentPath(tempDir, 'rstest-environment-package-marker'),
    ]);
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

    const resolvedPaths = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const promise = loadTestEnvironment('package-marker', resolvedPaths);

    await expect(promise).rejects.toThrow('fallback package import failed');
    await expect(promise).rejects.toHaveProperty(
      'cause.message',
      'fallback package import failed',
    );
  });

  it('should surface fallback import errors after invalid package matches', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    createPackage(
      tempDir,
      'package-marker',
      'export default { name: "not-an-environment" };',
    );
    createPackage(
      tempDir,
      'rstest-environment-package-marker',
      'throw new Error("fallback package import failed");',
    );

    const resolvedPaths = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);
    const promise = loadTestEnvironment('package-marker', resolvedPaths);

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

    const resolvedPaths = await resolveTestEnvironmentPath('package-marker', [
      realpathSync(tempDir),
    ]);

    await expect(
      loadTestEnvironment('package-marker', resolvedPaths),
    ).rejects.toThrow(
      'must export a test environment object as the default export',
    );
  });

  it('should reject named environment exports in worker loading', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const environmentPath = join(tempDir, 'named-environment.mjs');

    writeFileSync(
      environmentPath,
      environmentModule('named-export-environment').replace(
        'export default',
        'export const environment =',
      ),
    );

    const resolvedPaths = await resolveTestEnvironmentPath(
      './named-environment.mjs',
      [realpathSync(tempDir)],
    );

    await expect(
      loadTestEnvironment('./named-environment.mjs', resolvedPaths),
    ).rejects.toThrow(
      'must export a test environment object as the default export',
    );
  });
});
