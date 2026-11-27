import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { dirname, join, resolve } from 'pathe';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const coreDir = resolve(repoRoot, 'packages/core');
const browserDir = resolve(repoRoot, 'packages/browser');
const tscBin = resolve(repoRoot, 'node_modules/typescript/bin/tsc');

const linkPackage = (tmpDir: string, pkgName: string, target: string): void => {
  const linkPath = join(tmpDir, 'node_modules', pkgName);
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath, 'junction');
};

describe('@rstest/browser public types', () => {
  it('emits declarations cleanly for BrowserElementExpect and ToMatchScreenshotOptions under declaration + strict', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'rstest-browser-dts-'));
    try {
      linkPackage(tmpDir, '@rstest/core', coreDir);
      linkPackage(tmpDir, '@rstest/browser', browserDir);
      for (const pkg of [
        '@rsbuild/core',
        '@types/chai',
        '@types/node',
        'chai',
      ]) {
        const target = [coreDir, repoRoot]
          .map((root) => join(root, 'node_modules', pkg))
          .find((candidate) => existsSync(candidate));
        if (target) {
          linkPackage(tmpDir, pkg, target);
        }
      }

      writeFileSync(
        join(tmpDir, 'index.ts'),
        `
          import { expect } from '@rstest/core';
          import {
            type BrowserElementExpect,
            type Locator,
            type ToMatchScreenshotOptions,
          } from '@rstest/browser';

          export function expectElement(locator: Locator) {
            return expect.element(locator);
          }

          export const typedExpectElement = (
            locator: Locator,
          ): BrowserElementExpect => expect.element(locator);

          export function makeScreenshotOptions() {
            const options: NonNullable<
              Parameters<ReturnType<typeof expect>['toMatchScreenshot']>[1]
            > = { threshold: 0.1 };
            return options;
          }

          export const explicitScreenshotOptions: ToMatchScreenshotOptions = {
            threshold: 0.1,
            maxDiffPixels: 10,
          };

          export const poll = () => expect.poll(() => 1);
          export const resolves = () => expect(Promise.resolve(1)).resolves;

          export async function verifyAsyncAssertionHelpers() {
            await poll().toBe(1);
            await poll().not.toBe(2);
            await resolves().toBe(1);
            await resolves().not.toBe(2);
          }
        `,
      );
      writeFileSync(
        join(tmpDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            declaration: true,
            emitDeclarationOnly: true,
            outDir: './out',
            skipLibCheck: true,
            types: ['node'],
          },
          include: ['index.ts'],
        }),
      );

      const result = spawnSync(
        process.execPath,
        [tscBin, '--project', join(tmpDir, 'tsconfig.json')],
        {
          encoding: 'utf-8',
        },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
