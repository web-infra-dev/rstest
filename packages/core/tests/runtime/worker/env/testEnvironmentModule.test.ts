import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { loadTestEnvironmentModule } from '../../../../src/runtime/worker/env/testEnvironmentModule';

const writeModule = (root: string, name: string, source: string): string => {
  const modulePath = path.join(root, name);
  fs.writeFileSync(modulePath, source);
  return modulePath;
};

describe('loadTestEnvironmentModule', () => {
  it('loads the prebundle when its exports are valid', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-env-loader-'));

    try {
      const resolvedPath = writeModule(
        root,
        'resolved.mjs',
        'export class JSDOM { static source = "resolved" }',
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
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back when the jsdom bundle fails its runtime probe', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rstest-env-probe-fallback-'),
    );

    try {
      const resolvedPath = writeModule(
        root,
        'resolved.mjs',
        'export class JSDOM { static source = "resolved" }',
      );
      const bundlePath = writeModule(
        root,
        'bundle.mjs',
        `export class JSDOM {
          static source = "bundle";
          window = {
            document: { documentElement: {} },
            getComputedStyle() { throw new Error("incompatible cssstyle"); },
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
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the resolved package entry when the prebundle is invalid', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-env-fallback-'));

    try {
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
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back when the prebundle cannot be imported', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rstest-env-import-fallback-'),
    );

    try {
      const resolvedPath = writeModule(
        root,
        'resolved.mjs',
        'export class JSDOM { static source = "resolved" }',
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
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
