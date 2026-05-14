import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { ensureTestEnvironmentDependencies } from '../../src/core/envDependencies';

const originalStdinIsTTY = process.stdin.isTTY;

const restoreStdinIsTTY = () => {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: originalStdinIsTTY,
  });
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-jsdom-'));
    const projectRoot = path.join(root, 'project');
    fs.mkdirSync(projectRoot);

    try {
      const installer = rs.fn(async (packageName: string, cwd: string) => {
        mockPackage(cwd, packageName);
        return true;
      });

      await ensureTestEnvironmentDependencies(
        [createProject(projectRoot, 'jsdom')],
        root,
        {},
        installer,
      );

      expect(installer).toHaveBeenCalledWith('jsdom', root, 'jsdom', {});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws early when installer does not install the test environment dependency', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-missing-env-'));
    const projectRoot = path.join(root, 'project');
    fs.mkdirSync(projectRoot);

    try {
      const installer = rs.fn(async () => false);

      await expect(
        ensureTestEnvironmentDependencies(
          [createProject(projectRoot, 'jsdom')],
          root,
          {},
          installer,
          () => false,
        ),
      ).rejects.toThrow(
        `Failed to load testEnvironment "jsdom" dependency: jsdom in ${root}, please make sure it is installed.`,
      );
      expect(installer).toHaveBeenCalledWith('jsdom', root, 'jsdom', {});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('asks whether to install happy-dom for happy-dom test environment', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-happy-dom-'));
    const projectRoot = path.join(root, 'project');
    fs.mkdirSync(projectRoot);

    try {
      const installer = rs.fn(async (packageName: string, cwd: string) => {
        mockPackage(cwd, packageName);
        return true;
      });

      await ensureTestEnvironmentDependencies(
        [createProject(projectRoot, 'happy-dom')],
        root,
        {},
        installer,
      );

      expect(installer).toHaveBeenCalledWith(
        'happy-dom',
        root,
        'happy-dom',
        {},
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
