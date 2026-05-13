import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { loadCoverageProvider } from '../../src/coverage';
import {
  ensureCoverageProviderInstalled,
  installCoverageProvider,
} from '../../src/coverage/install';
import type { InstallPackageOptions } from '../../src/utils/packageInstaller';

const originalStdinIsTTY = process.stdin.isTTY;
const originalCI = process.env.CI;

const setStdinIsTTY = (value: boolean) => {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value,
  });
};

const restoreEnvironment = () => {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: originalStdinIsTTY,
  });

  if (originalCI === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = originalCI;
  }
};

const mockProviderPackage = (root: string) => {
  const providerDir = path.join(root, 'node_modules/@rstest/coverage-istanbul');
  fs.mkdirSync(providerDir, { recursive: true });
  fs.writeFileSync(
    path.join(providerDir, 'package.json'),
    JSON.stringify({ type: 'module', main: 'index.js' }),
  );
  fs.writeFileSync(
    path.join(providerDir, 'index.js'),
    [
      'export class CoverageProvider {}',
      'export const pluginCoverage = () => ({ name: "mock-coverage" });',
    ].join('\n'),
  );
};

describe('loadCoverageProvider', () => {
  afterEach(() => {
    restoreEnvironment();
    rs.resetAllMocks();
  });

  it('asks whether to install the coverage provider and loads it after install', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-provider-'));

    try {
      setStdinIsTTY(true);
      delete process.env.CI;
      const confirm = rs.fn<() => Promise<boolean>>(() =>
        Promise.resolve(true),
      );
      const detectPackageManager = rs.fn(() =>
        Promise.resolve({ agent: 'pnpm', name: 'pnpm' } as const),
      );
      const spawn: NonNullable<InstallPackageOptions['spawn']> = rs.fn(
        (_command, _args, options) => {
          mockProviderPackage(options?.cwd as string);
          return {
            on(event: string, listener: (code?: number) => void) {
              if (event === 'exit') {
                listener(0);
              }
              return this;
            },
          } as ReturnType<NonNullable<InstallPackageOptions['spawn']>>;
        },
      );
      const installer = (moduleName: string, cwd: string) =>
        installCoverageProvider(moduleName, cwd, {
          confirm,
          detectPackageManager,
          spawn,
        });

      await ensureCoverageProviderInstalled({ enabled: true }, root, installer);
      const provider = await loadCoverageProvider({ enabled: true }, root);

      expect(confirm).toHaveBeenCalledWith({
        message:
          '@rstest/coverage-istanbul is required for coverage. Install it now?',
        initialValue: true,
      });
      expect(spawn).toHaveBeenCalledWith(
        'pnpm',
        ['add', '-D', '@rstest/coverage-istanbul'],
        expect.objectContaining({ cwd: root, stdio: 'inherit' }),
      );
      expect(provider.CoverageProvider).toBeDefined();
      expect(provider.pluginCoverage({ enabled: true }).name).toBe(
        'mock-coverage',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
