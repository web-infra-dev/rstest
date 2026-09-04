import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { loadCoverageProvider } from '../../src/coverage';
import {
  ensureCoverageProviderInstalled,
  installCoverageProvider,
} from '../../src/coverage/install';

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
    rs.resetAllMocks();
  });

  it('asks whether to install the coverage provider and loads it after install', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-provider-'));

    try {
      const confirm = rs.fn<() => Promise<boolean>>(() =>
        Promise.resolve(true),
      );
      const packageInstaller = rs.fn(async (_packageName, options) => {
        mockProviderPackage(options.cwd);
      });
      const installer = (moduleName: string, cwd: string) =>
        installCoverageProvider(moduleName, cwd, {
          confirm,
          installPackage: packageInstaller,
        });

      await ensureCoverageProviderInstalled({ enabled: true }, root, {
        installer,
      });
      const provider = await loadCoverageProvider({ enabled: true }, root);

      expect(confirm).toHaveBeenCalledWith({
        message:
          '@rstest/coverage-istanbul is required for coverage. Install it now?',
        initialValue: true,
      });
      expect(packageInstaller).toHaveBeenCalledWith(
        `@rstest/coverage-istanbul@${RSTEST_VERSION}`,
        {
          cwd: root,
          dev: true,
          silent: false,
        },
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
