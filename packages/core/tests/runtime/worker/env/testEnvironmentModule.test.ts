import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { withTempDir } from '../../../helpers/tempDir';
import { loadTestEnvironmentModule } from '../../../../src/runtime/worker/env/testEnvironmentModule';

const writeModule = (root: string, name: string, source: string): string => {
  const modulePath = path.join(root, name);
  fs.writeFileSync(modulePath, source);
  return modulePath;
};

const createJSDOMModule = (jsdomClass: string): string => `
export class CookieJar {}
export class ResourceLoader {}
export class VirtualConsole {}
${jsdomClass}
`;

describe('loadTestEnvironmentModule', () => {
  it('loads the prebundle when its exports are valid', async () => {
    await withTempDir('rstest-env-loader-', async (root) => {
      const resolvedPath = writeModule(
        root,
        'resolved.mjs',
        createJSDOMModule('export class JSDOM { static source = "resolved" }'),
      );
      const bundlePath = writeModule(
        root,
        'bundle.mjs',
        createJSDOMModule(`export class JSDOM {
          static source = "bundle";
          window = {
            document: { documentElement: {} },
            getComputedStyle() {},
            close() {},
          };
        }`),
      );

      const loaded = await loadTestEnvironmentModule({
        name: 'jsdom',
        packageName: 'jsdom',
        resolvedPath,
        bundlePath,
      });

      expect(loaded?.name).toBe('jsdom');
      if (loaded?.name !== 'jsdom') {
        throw new Error('Expected the jsdom dependency.');
      }
      expect(
        (loaded.module.JSDOM as unknown as { source: string }).source,
      ).toBe('bundle');
      expect(
        await loadTestEnvironmentModule({
          name: 'jsdom',
          packageName: 'jsdom',
          resolvedPath,
          bundlePath,
        }),
      ).toBe(loaded);
    });
  });

  it('falls back when the jsdom bundle fails its runtime probe', async () => {
    await withTempDir('rstest-env-probe-fallback-', async (root) => {
      const resolvedPath = writeModule(
        root,
        'resolved.mjs',
        createJSDOMModule('export class JSDOM { static source = "resolved" }'),
      );
      const bundlePath = writeModule(
        root,
        'bundle.mjs',
        createJSDOMModule(`export class JSDOM {
          static source = "bundle";
          window = {
            document: { documentElement: {} },
            getComputedStyle() { throw new Error("incompatible cssstyle"); },
            close() {},
          };
        }`),
      );

      const loaded = await loadTestEnvironmentModule({
        name: 'jsdom',
        packageName: 'jsdom',
        resolvedPath,
        bundlePath,
      });

      if (loaded?.name !== 'jsdom') {
        throw new Error('Expected the jsdom dependency.');
      }
      expect(
        (loaded.module.JSDOM as unknown as { source: string }).source,
      ).toBe('resolved');
    });
  });

  it('falls back when the jsdom prebundle omits a required export', async () => {
    await withTempDir('rstest-env-export-fallback-', async (root) => {
      const resolvedPath = writeModule(
        root,
        'resolved.mjs',
        createJSDOMModule('export class JSDOM { static source = "resolved" }'),
      );
      const bundlePath = writeModule(
        root,
        'bundle.mjs',
        `export class JSDOM {
          static source = "bundle";
          window = {
            document: { documentElement: {} },
            getComputedStyle() {},
            close() {},
          };
        }`,
      );

      const loaded = await loadTestEnvironmentModule({
        name: 'jsdom',
        packageName: 'jsdom',
        resolvedPath,
        bundlePath,
      });

      if (loaded?.name !== 'jsdom') {
        throw new Error('Expected the jsdom dependency.');
      }
      expect(
        (loaded.module.JSDOM as unknown as { source: string }).source,
      ).toBe('resolved');
    });
  });

  it('falls back to the resolved package entry when the prebundle is invalid', async () => {
    await withTempDir('rstest-env-fallback-', async (root) => {
      const resolvedPath = writeModule(
        root,
        'resolved.mjs',
        'export class GlobalWindow { static source = "resolved" }',
      );
      const bundlePath = writeModule(
        root,
        'bundle.mjs',
        'export const unrelated = true;',
      );

      const loaded = await loadTestEnvironmentModule({
        name: 'happy-dom',
        packageName: 'happy-dom',
        resolvedPath,
        bundlePath,
      });

      expect(loaded?.name).toBe('happy-dom');
      if (loaded?.name !== 'happy-dom') {
        throw new Error('Expected the happy-dom dependency.');
      }
      expect(
        (loaded.module.GlobalWindow as unknown as { source: string }).source,
      ).toBe('resolved');
    });
  });

  it('falls back when the prebundle cannot be imported', async () => {
    await withTempDir('rstest-env-import-fallback-', async (root) => {
      const resolvedPath = writeModule(
        root,
        'resolved.mjs',
        createJSDOMModule('export class JSDOM { static source = "resolved" }'),
      );
      const bundlePath = writeModule(
        root,
        'bundle.mjs',
        'export const invalid syntax',
      );

      const loaded = await loadTestEnvironmentModule({
        name: 'jsdom',
        packageName: 'jsdom',
        resolvedPath,
        bundlePath,
      });

      if (loaded?.name !== 'jsdom') {
        throw new Error('Expected the jsdom dependency.');
      }
      expect(
        (loaded.module.JSDOM as unknown as { source: string }).source,
      ).toBe('resolved');
    });
  });

  it('reports the native module path and expected exports', async () => {
    await withTempDir('rstest-env-invalid-native-', async (root) => {
      const resolvedPath = writeModule(
        root,
        'resolved.mjs',
        'export class JSDOM {}',
      );

      await expect(
        loadTestEnvironmentModule({
          name: 'jsdom',
          packageName: 'jsdom',
          resolvedPath,
        }),
      ).rejects.toThrow(
        `Invalid jsdom test environment dependency loaded from ${resolvedPath}. Expected exports: CookieJar, JSDOM, VirtualConsole.`,
      );
    });
  });
});
