import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from '@rstest/core';
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

describe('loadTestEnvironment', () => {
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

    const environment = await loadTestEnvironment(
      './fixtures/custom-environment.mjs',
      [firstRoot, secondRoot],
    );

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

    const environment = await loadTestEnvironment('package-marker', [
      realpathSync(tempDir),
    ]);

    expect(environment.name).toBe('fallback-package-environment');
  });

  it('should reject named environment exports', async () => {
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
      loadTestEnvironment('./named-environment.mjs', [realpathSync(tempDir)]),
    ).rejects.toThrow(
      'must export a test environment object as the default export',
    );
  });
});
