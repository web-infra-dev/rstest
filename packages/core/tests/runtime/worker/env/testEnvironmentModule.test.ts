import fs from 'node:fs';
import { RSTEST_JSDOM_GLOBAL_PREFIX } from '../../../../src/utils/constants';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { withTempDir } from '../../../helpers/tempDir';
import {
  installTestEnvironmentModule,
  loadTestEnvironmentModule,
} from '../../../../src/runtime/worker/env/testEnvironmentModule';

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
      expect(fs.existsSync(`${bundlePath}.probe-ok`)).toBe(true);
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
      expect(fs.existsSync(`${bundlePath}.probe-ok`)).toBe(false);
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
      const onFallback = rs.fn();
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

      const loaded = await loadTestEnvironmentModule(
        {
          name: 'happy-dom',
          packageName: 'happy-dom',
          resolvedPath,
          bundlePath,
        },
        onFallback,
      );

      expect(loaded?.name).toBe('happy-dom');
      if (loaded?.name !== 'happy-dom') {
        throw new Error('Expected the happy-dom dependency.');
      }
      expect(
        (loaded.module.GlobalWindow as unknown as { source: string }).source,
      ).toBe('resolved');
      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledWith({
        packageName: 'happy-dom',
        bundlePath,
        resolvedPath,
        reason: expect.stringContaining(
          'Expected exports: GlobalWindow or Window.',
        ),
      });
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

it.for(['success', 'import failure', 'probe failure'])(
  'publishes the selected jsdom exports synchronously after %s',
  async (mode) => {
    await withTempDir('rstest-env-bridge-', async (root) => {
      const resolvedPath = writeModule(
        root,
        'native.mjs',
        createJSDOMModule('export class JSDOM {}'),
      );
      const bundlePath = writeModule(
        root,
        'bundle.mjs',
        mode === 'import failure'
          ? 'throw new Error("broken import");'
          : createJSDOMModule(`export class JSDOM {
            window = {
              document: { documentElement: {} },
              getComputedStyle() { ${mode === 'probe failure' ? 'throw new Error("broken probe")' : ''} },
              close() {},
            };
          }`),
      );
      const reference = {
        name: 'jsdom',
        packageName: 'jsdom',
        resolvedPath,
        bundlePath,
      } as const;
      const target = {};
      const fallback = rs.fn();
      const restore = await installTestEnvironmentModule(
        reference,
        target,
        fallback,
      );
      const loaded = await loadTestEnvironmentModule(reference);
      if (loaded?.name !== 'jsdom') throw new Error('Expected jsdom');
      expect(
        Reflect.get(target, RSTEST_JSDOM_GLOBAL_PREFIX + resolvedPath),
      ).toEqual({ ...loaded.module });
      expect(fallback).toHaveBeenCalledTimes(mode === 'success' ? 0 : 1);
      const exports = Reflect.get(
        target,
        RSTEST_JSDOM_GLOBAL_PREFIX + resolvedPath,
      );
      const original = loaded.module.JSDOM;
      const spy = rs.spyOn(exports, 'JSDOM');
      expect(exports.JSDOM).not.toBe(original);
      expect(loaded.module.JSDOM).toBe(original);
      spy.mockRestore();
      restore();
      expect(
        Reflect.has(target, RSTEST_JSDOM_GLOBAL_PREFIX + resolvedPath),
      ).toBe(false);
    });
  },
);
