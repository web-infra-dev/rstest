import fs from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import path from 'node:path';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { withTempDir } from '../helpers/tempDir';
import { ensureTestEnvironmentDependencies } from '../../src/core/envDependencies';

const originalStdinIsTTY = process.stdin.isTTY;

const restoreStdinIsTTY = () => {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: originalStdinIsTTY,
  });
};

const isMockPackageInstalled = (packageName: string, root: string) => {
  return fs.existsSync(path.join(root, 'node_modules', packageName));
};

const mockPackage = (root: string, packageName: string) => {
  const packageDir = path.join(root, 'node_modules', packageName);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ type: 'module', main: 'index.js' }),
  );
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'export {};');
};

const createProject = (rootPath: string, environmentName: string) => ({
  rootPath,
  normalizedConfig: {
    testEnvironment: {
      name: environmentName,
    },
  },
});

describe('ensureTestEnvironmentDependencies', () => {
  afterEach(() => {
    restoreStdinIsTTY();
    rs.resetAllMocks();
  });

  it('asks whether to install jsdom for jsdom test environment', async () => {
    await withTempDir('rstest-jsdom-', async (root) => {
      const projectRoot = path.join(root, 'project');
      fs.mkdirSync(projectRoot);

      const installer = rs.fn(async (packageName: string, cwd: string) => {
        mockPackage(cwd, packageName);
        return true;
      });

      await ensureTestEnvironmentDependencies(
        [createProject(projectRoot, 'jsdom')],
        root,
        {},
        installer,
        isMockPackageInstalled,
      );

      expect(installer).toHaveBeenCalledWith('jsdom', root, 'jsdom', {});
    });
  });

  it('skips install when the test environment dependency resolves from core', async () => {
    await withTempDir('rstest-core-env-', async (root) => {
      const projectRoot = path.join(root, 'project');
      fs.mkdirSync(projectRoot);

      const installer = rs.fn(async () => false);

      await ensureTestEnvironmentDependencies(
        [createProject(projectRoot, 'jsdom')],
        root,
        {},
        installer,
        (_packageName, resolutionRoot) =>
          resolutionRoot !== root && resolutionRoot !== projectRoot,
      );

      expect(installer).not.toHaveBeenCalled();
    });
  });

  it('throws early when installer does not install the test environment dependency', async () => {
    await withTempDir('rstest-missing-env-', async (root) => {
      const projectRoot = path.join(root, 'project');
      fs.mkdirSync(projectRoot);

      const installer = rs.fn(async () => false);

      let error: unknown;
      try {
        await ensureTestEnvironmentDependencies(
          [createProject(projectRoot, 'jsdom')],
          root,
          {},
          installer,
          () => false,
        );
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : String(error);
      expect(stripVTControlCharacters(message)).toContain(
        `Failed to load testEnvironment "jsdom" dependency: jsdom in ${root}, please make sure it is installed.`,
      );
      expect(installer).toHaveBeenCalledWith('jsdom', root, 'jsdom', {});
    });
  });

  it('asks whether to install happy-dom for happy-dom test environment', async () => {
    await withTempDir('rstest-happy-dom-', async (root) => {
      const projectRoot = path.join(root, 'project');
      fs.mkdirSync(projectRoot);

      const installer = rs.fn(async (packageName: string, cwd: string) => {
        mockPackage(cwd, packageName);
        return true;
      });

      await ensureTestEnvironmentDependencies(
        [createProject(projectRoot, 'happy-dom')],
        root,
        {},
        installer,
        isMockPackageInstalled,
      );

      expect(installer).toHaveBeenCalledWith(
        'happy-dom',
        root,
        'happy-dom',
        {},
      );
    });
  });
});
