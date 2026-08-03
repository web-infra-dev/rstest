import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import type { ProjectContext, TestEnvironmentPrebundle } from '../../src/types';
import { prepareTestEnvironmentModules } from '../../src/core/testEnvironmentModule';

const createProject = (
  rootPath: string,
  {
    environmentName = 'jsdom',
    outputModule = true,
    prebundle,
  }: {
    environmentName?: string;
    outputModule?: boolean;
    prebundle?: TestEnvironmentPrebundle;
  } = {},
): ProjectContext => {
  return {
    rootPath,
    environmentName,
    outputModule,
    normalizedConfig: {
      testEnvironment: {
        name: environmentName,
        ...(prebundle === undefined ? {} : { prebundle }),
      },
    },
  } as ProjectContext;
};

const createPackage = (
  root: string,
  source: string,
  {
    name = 'jsdom',
    type = 'module',
    version = '30.0.1',
  }: {
    name?: string;
    type?: 'commonjs' | 'module';
    version?: string;
  } = {},
): string => {
  const packageRoot = path.join(root, 'node_modules', name);
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name,
      type,
      version,
      main: './index.js',
    }),
  );
  const entryPath = path.join(packageRoot, 'index.js');
  fs.writeFileSync(entryPath, source);
  return fs.realpathSync(entryPath);
};

describe('prepareTestEnvironmentModules', () => {
  it('automatically creates a bundle for a supported project-resolved environment dependency', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-env-bundle-'));
    const projectRoot = path.join(root, 'project');
    fs.mkdirSync(projectRoot);
    createPackage(root, 'export class JSDOM {}');
    const canvasPath = createPackage(projectRoot, 'exports.token = "canvas";', {
      name: 'canvas',
      type: 'commonjs',
    });
    createPackage(
      projectRoot,
      `
const canvas = require('canvas');
exports.JSDOM = class JSDOM {};
exports.canvasToken = canvas.token;
`,
      { type: 'commonjs' },
    );
    const projectJsdomPath = fs.realpathSync(
      path.join(projectRoot, 'node_modules', 'jsdom', 'index.js'),
    );

    const result = await prepareTestEnvironmentModules({
      projects: [createProject(projectRoot)],
      rootPath: root,
    });

    try {
      const moduleReference = result.modules.get('jsdom');
      expect(moduleReference).toMatchObject({
        name: 'jsdom',
        packageName: 'jsdom',
        resolvedPath: projectJsdomPath,
      });
      expect(moduleReference?.bundlePath).toBeTruthy();
      if (!moduleReference?.bundlePath) {
        throw new Error('Expected jsdom to be bundled.');
      }
      expect(fs.existsSync(moduleReference.bundlePath)).toBe(true);

      const bundled = await import(
        pathToFileURL(moduleReference.bundlePath).href
      );
      expect(typeof bundled.JSDOM).toBe('function');
      expect(bundled.canvasToken).toBe('canvas');
      expect(fs.readFileSync(moduleReference.bundlePath, 'utf8')).toContain(
        canvasPath,
      );
      expect(moduleReference.bundlePath.split(path.sep)).toContain(
        'node_modules',
      );
    } finally {
      const bundlePath = result.modules.get('jsdom')?.bundlePath;
      await result.cleanup();
      expect(bundlePath && fs.existsSync(bundlePath)).toBe(false);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a missing optional canvas dependency external', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rstest-env-optional-canvas-'),
    );
    createPackage(
      root,
      `
let canvasInstalled = false;
try {
  require.resolve('canvas');
  canvasInstalled = true;
} catch {}
if (canvasInstalled) {
  require('canvas');
}
exports.JSDOM = class JSDOM {};
exports.canvasInstalled = canvasInstalled;
`,
      { type: 'commonjs', version: '15.2.0' },
    );

    const result = await prepareTestEnvironmentModules({
      projects: [createProject(root)],
      rootPath: root,
    });

    try {
      const moduleReference = result.modules.get('jsdom');
      expect(moduleReference?.bundlePath).toBeTruthy();
      if (!moduleReference?.bundlePath) {
        throw new Error('Expected jsdom to be bundled.');
      }

      const bundled = await import(
        pathToFileURL(moduleReference.bundlePath).href
      );
      expect(typeof bundled.JSDOM).toBe('function');
      expect(bundled.canvasInstalled).toBe(false);
    } finally {
      await result.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['14.1.0', '31.0.0'])(
    'keeps unsupported jsdom %s on the native dependency path',
    async (version) => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'rstest-env-unsupported-version-'),
      );
      createPackage(root, 'export class JSDOM {}', { version });

      const result = await prepareTestEnvironmentModules({
        projects: [createProject(root)],
        rootPath: root,
      });

      try {
        const moduleReference = result.modules.get('jsdom');
        expect(moduleReference?.resolvedPath).toBeTruthy();
        expect(moduleReference?.bundlePath).toBeUndefined();
      } finally {
        await result.cleanup();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('keeps unsupported happy-dom versions on the native dependency path', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rstest-env-unsupported-happy-dom-'),
    );
    createPackage(root, 'export class Window {}', {
      name: 'happy-dom',
      version: '21.0.0',
    });

    const result = await prepareTestEnvironmentModules({
      projects: [createProject(root, { environmentName: 'happy-dom' })],
      rootPath: root,
    });

    try {
      const moduleReference = result.modules.get('happy-dom');
      expect(moduleReference?.resolvedPath).toBeTruthy();
      expect(moduleReference?.bundlePath).toBeUndefined();
    } finally {
      await result.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('automatically creates a bundle for supported happy-dom 20', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rstest-env-supported-happy-dom-'),
    );
    createPackage(root, 'export class Window {}', {
      name: 'happy-dom',
      version: '20.11.1',
    });

    const result = await prepareTestEnvironmentModules({
      projects: [createProject(root, { environmentName: 'happy-dom' })],
      rootPath: root,
    });

    try {
      const moduleReference = result.modules.get('happy-dom');
      expect(moduleReference?.bundlePath).toBeTruthy();
      if (!moduleReference?.bundlePath) {
        throw new Error('Expected happy-dom to be bundled.');
      }
      const bundled = await import(
        pathToFileURL(moduleReference.bundlePath).href
      );
      expect(typeof bundled.Window).toBe('function');
    } finally {
      await result.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('forces the happy-dom prebundle outside the automatic version matrix', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rstest-env-force-happy-dom-'),
    );
    createPackage(root, 'export class Window {}', {
      name: 'happy-dom',
      version: '21.0.0',
    });

    const result = await prepareTestEnvironmentModules({
      projects: [
        createProject(root, {
          environmentName: 'happy-dom',
          prebundle: true,
        }),
      ],
      rootPath: root,
    });

    try {
      const moduleReference = result.modules.get('happy-dom');
      expect(moduleReference?.bundlePath).toBeTruthy();
      if (!moduleReference?.bundlePath) {
        throw new Error('Expected happy-dom to be bundled.');
      }
      const bundled = await import(
        pathToFileURL(moduleReference.bundlePath).href
      );
      expect(typeof bundled.Window).toBe('function');
    } finally {
      await result.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates the prebundle independently of the test output module format', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-env-cjs-'));
    createPackage(root, 'export class JSDOM {}');

    const result = await prepareTestEnvironmentModules({
      projects: [createProject(root, { outputModule: false })],
      rootPath: root,
    });

    try {
      const moduleReference = result.modules.get('jsdom');
      expect(moduleReference?.resolvedPath).toBeTruthy();
      expect(moduleReference?.bundlePath).toBeTruthy();
      if (!moduleReference?.bundlePath) {
        throw new Error('Expected jsdom to be bundled.');
      }
      const bundled = await import(
        pathToFileURL(moduleReference.bundlePath).href
      );
      expect(typeof bundled.JSDOM).toBe('function');
    } finally {
      await result.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not prebundle when prebundle is false', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-env-native-'));
    createPackage(root, 'export class JSDOM {}');

    const result = await prepareTestEnvironmentModules({
      projects: [createProject(root, { prebundle: false })],
      rootPath: root,
    });

    try {
      expect(result.modules.get('jsdom')).toMatchObject({
        name: 'jsdom',
      });
      expect(result.modules.get('jsdom')?.bundlePath).toBeUndefined();
    } finally {
      await result.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the native entry when the prebundle build fails', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rstest-env-build-fallback-'),
    );
    const resolvedPath = createPackage(
      root,
      `import './missing-dependency.js';
export class JSDOM {}`,
    );

    const result = await prepareTestEnvironmentModules({
      projects: [createProject(root, { prebundle: true })],
      rootPath: root,
    });

    try {
      expect(result.modules.get('jsdom')).toEqual({
        name: 'jsdom',
        packageName: 'jsdom',
        resolvedPath,
        bundlePath: undefined,
      });
    } finally {
      await result.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('forces the prebundle outside the automatic version matrix', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-env-force-'));
    createPackage(root, 'export class JSDOM {}', { version: '31.0.0' });

    const result = await prepareTestEnvironmentModules({
      projects: [createProject(root, { prebundle: true })],
      rootPath: root,
    });

    try {
      expect(result.modules.get('jsdom')?.bundlePath).toBeTruthy();
    } finally {
      await result.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
