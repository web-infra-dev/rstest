import { withTempDir } from '../helpers/tempDir';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import type { ProjectContext, TestEnvironmentPrebundle } from '../../src/types';
import { prepareTestEnvironmentModules } from '../../src/core/testEnvironmentModule';
import { logger } from '../../src/utils';

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
    packageExports,
    type = 'module',
    version = '30.0.1',
  }: {
    name?: string;
    packageExports?: Record<string, string>;
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
      ...(packageExports ? { exports: packageExports } : {}),
    }),
  );
  const entryPath = path.join(packageRoot, 'index.js');
  fs.writeFileSync(entryPath, source);
  return fs.realpathSync(entryPath);
};

describe('prepareTestEnvironmentModules', () => {
  it('automatically creates a bundle for a supported project-resolved environment dependency', async () => {
    await withTempDir('rstest-env-bundle-', async (root) => {
      const projectRoot = path.join(root, 'project');
      fs.mkdirSync(projectRoot);
      createPackage(root, 'export class JSDOM {}');
      const canvasPath = createPackage(
        projectRoot,
        'exports.token = "canvas";',
        {
          name: 'canvas',
          type: 'commonjs',
        },
      );
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
        projects: [createProject(projectRoot, { prebundle: 'auto' })],
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
      }
    });
  });

  it('does not inherit project tsconfig paths for the prebundle', async () => {
    await withTempDir('rstest-env-tsconfig-paths-', async (root) => {
      fs.writeFileSync(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: {
              'environment-alias': ['./aliased.js'],
            },
          },
        }),
      );
      fs.writeFileSync(
        path.join(root, 'aliased.js'),
        'export const token = "tsconfig";',
      );
      createPackage(root, 'export const token = "node_modules";', {
        name: 'environment-alias',
      });
      createPackage(
        root,
        `
import { token } from 'environment-alias';
export class JSDOM {}
export const aliasToken = token;
`,
      );

      const result = await prepareTestEnvironmentModules({
        projects: [createProject(root, { prebundle: true })],
        rootPath: root,
      });

      try {
        const bundlePath = result.modules.get('jsdom')?.bundlePath;
        expect(bundlePath).toBeTruthy();
        if (!bundlePath) {
          throw new Error('Expected jsdom to be bundled.');
        }
        const bundled = await import(pathToFileURL(bundlePath).href);
        expect(bundled.aliasToken).toBe('node_modules');
      } finally {
        await result.cleanup();
      }
    });
  });

  it('preserves the worker NODE_ENV at prebundle runtime', async () => {
    await withTempDir('rstest-env-node-env-', async (root) => {
      createPackage(
        root,
        `
export class JSDOM {}
export const readNodeEnv = () => process.env.NODE_ENV;
`,
      );

      const result = await prepareTestEnvironmentModules({
        projects: [createProject(root, { prebundle: true })],
        rootPath: root,
      });
      const previousNodeEnv = process.env.NODE_ENV;

      try {
        const bundlePath = result.modules.get('jsdom')?.bundlePath;
        expect(bundlePath).toBeTruthy();
        if (!bundlePath) {
          throw new Error('Expected jsdom to be bundled.');
        }
        const bundled = await import(pathToFileURL(bundlePath).href);
        process.env.NODE_ENV = 'rstest-runtime-probe';
        expect(bundled.readNodeEnv()).toBe('rstest-runtime-probe');
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
        await result.cleanup();
      }
    });
  });

  it('preserves bare Node builtins in non-literal dynamic imports', async () => {
    await withTempDir('rstest-env-dynamic-builtin-', async (root) => {
      createPackage(
        root,
        `
export class JSDOM {}
export const loadModule = (specifier) => import(specifier);
`,
      );

      const result = await prepareTestEnvironmentModules({
        projects: [createProject(root, { prebundle: true })],
        rootPath: root,
      });

      try {
        const bundlePath = result.modules.get('jsdom')?.bundlePath;
        expect(bundlePath).toBeTruthy();
        if (!bundlePath) {
          throw new Error('Expected jsdom to be bundled.');
        }
        const bundled = await import(pathToFileURL(bundlePath).href);
        const nodeFs = await bundled.loadModule('fs');
        expect(typeof nodeFs.readFile).toBe('function');
      } finally {
        await result.cleanup();
      }
    });
  });

  it('reads the version from the resolved environment package', async () => {
    await withTempDir('rstest-env-resolved-version-', async (root) => {
      const projectRoot = path.join(root, 'project');
      fs.mkdirSync(projectRoot);
      createPackage(root, 'export class Window {}', {
        name: 'happy-dom',
        version: '20.11.1',
      });
      const projectHappyDomPath = createPackage(
        projectRoot,
        'export class Window {}',
        {
          name: 'happy-dom',
          packageExports: { '.': './index.js' },
          version: '21.0.0',
        },
      );

      const result = await prepareTestEnvironmentModules({
        projects: [
          createProject(projectRoot, {
            environmentName: 'happy-dom',
            prebundle: 'auto',
          }),
        ],
        rootPath: root,
      });

      try {
        expect(result.modules.get('happy-dom')).toMatchObject({
          resolvedPath: projectHappyDomPath,
        });
        expect(result.modules.get('happy-dom')?.bundlePath).toBeUndefined();
      } finally {
        await result.cleanup();
      }
    });
  });

  it('emits ESM native externals as file URLs', async () => {
    await withTempDir('rstest-env-esm-external-', async (root) => {
      const projectRoot = path.join(root, 'project');
      fs.mkdirSync(projectRoot);
      const canvasPath = createPackage(
        projectRoot,
        'exports.token = "canvas";',
        {
          name: 'canvas',
          type: 'commonjs',
        },
      );
      createPackage(
        projectRoot,
        `
import canvas from 'canvas';
export class JSDOM {}
export const canvasToken = canvas.token;
`,
      );

      const result = await prepareTestEnvironmentModules({
        projects: [createProject(projectRoot, { prebundle: true })],
        rootPath: root,
      });

      try {
        const bundlePath = result.modules.get('jsdom')?.bundlePath;
        expect(bundlePath).toBeTruthy();
        if (!bundlePath) {
          throw new Error('Expected jsdom to be bundled.');
        }
        const bundled = await import(pathToFileURL(bundlePath).href);
        expect(bundled.canvasToken).toBe('canvas');
        expect(fs.readFileSync(bundlePath, 'utf8')).toContain(
          pathToFileURL(canvasPath).href,
        );
      } finally {
        await result.cleanup();
      }
    });
  });

  // cspell:word pnpapi
  it('keeps Yarn PnP runtime access external', async () => {
    await withTempDir('rstest-env-pnpapi-external-', async (root) => {
      createPackage(
        root,
        `
require('pnpapi');
exports.JSDOM = class JSDOM {};
`,
        { type: 'commonjs' },
      );

      const result = await prepareTestEnvironmentModules({
        projects: [createProject(root, { prebundle: true })],
        rootPath: root,
      });

      try {
        expect(result.modules.get('jsdom')?.bundlePath).toBeTruthy();
      } finally {
        await result.cleanup();
      }
    });
  });

  it('keeps a missing optional canvas dependency external', async () => {
    await withTempDir('rstest-env-optional-canvas-', async (root) => {
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
        projects: [createProject(root, { prebundle: 'auto' })],
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
      }
    });
  });

  it.each(['14.1.0', '31.0.0'])(
    'keeps unsupported jsdom %s on the native dependency path',
    async (version) => {
      await withTempDir('rstest-env-unsupported-version-', async (root) => {
        createPackage(root, 'export class JSDOM {}', { version });

        const result = await prepareTestEnvironmentModules({
          projects: [createProject(root, { prebundle: 'auto' })],
          rootPath: root,
        });

        try {
          const moduleReference = result.modules.get('jsdom');
          expect(moduleReference?.resolvedPath).toBeTruthy();
          expect(moduleReference?.bundlePath).toBeUndefined();
        } finally {
          await result.cleanup();
        }
      });
    },
  );

  it.each(['27.4.0', '28.1.0'])(
    'keeps jsdom %s on the native path because bundling can change its optional cssstyle resolution',
    async (version) => {
      await withTempDir('rstest-env-cssstyle-resolution-', async (root) => {
        createPackage(root, 'export class JSDOM {}', { version });

        const result = await prepareTestEnvironmentModules({
          projects: [createProject(root, { prebundle: 'auto' })],
          rootPath: root,
        });

        try {
          expect(result.modules.get('jsdom')?.resolvedPath).toBeTruthy();
          expect(result.modules.get('jsdom')?.bundlePath).toBeUndefined();
        } finally {
          await result.cleanup();
        }
      });
    },
  );

  it('keeps unsupported happy-dom versions on the native dependency path', async () => {
    await withTempDir('rstest-env-unsupported-happy-dom-', async (root) => {
      createPackage(root, 'export class Window {}', {
        name: 'happy-dom',
        version: '21.0.0',
      });

      const result = await prepareTestEnvironmentModules({
        projects: [
          createProject(root, {
            environmentName: 'happy-dom',
            prebundle: 'auto',
          }),
        ],
        rootPath: root,
      });

      try {
        const moduleReference = result.modules.get('happy-dom');
        expect(moduleReference?.resolvedPath).toBeTruthy();
        expect(moduleReference?.bundlePath).toBeUndefined();
      } finally {
        await result.cleanup();
      }
    });
  });

  it('automatically creates a bundle for supported happy-dom 20', async () => {
    await withTempDir('rstest-env-supported-happy-dom-', async (root) => {
      createPackage(root, 'export class Window {}', {
        name: 'happy-dom',
        version: '20.11.1',
      });

      const result = await prepareTestEnvironmentModules({
        projects: [
          createProject(root, {
            environmentName: 'happy-dom',
            prebundle: 'auto',
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
      }
    });
  });

  it('forces the happy-dom prebundle outside the automatic version matrix', async () => {
    await withTempDir('rstest-env-force-happy-dom-', async (root) => {
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
      }
    });
  });

  it('creates the prebundle independently of the test output module format', async () => {
    await withTempDir('rstest-env-cjs-', async (root) => {
      createPackage(root, 'export class JSDOM {}');

      const result = await prepareTestEnvironmentModules({
        projects: [
          createProject(root, { outputModule: false, prebundle: true }),
        ],
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
      }
    });
  });

  it('does not prebundle when prebundle is false', async () => {
    await withTempDir('rstest-env-native-', async (root) => {
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
      }
    });
  });

  it('does not prebundle by default', async () => {
    await withTempDir('rstest-env-default-native-', async (root) => {
      createPackage(root, 'export class JSDOM {}');

      const result = await prepareTestEnvironmentModules({
        projects: [createProject(root)],
        rootPath: root,
      });

      try {
        expect(result.modules.get('jsdom')).toMatchObject({
          name: 'jsdom',
        });
        expect(result.modules.get('jsdom')?.bundlePath).toBeUndefined();
      } finally {
        await result.cleanup();
      }
    });
  });

  it('falls back to the native entry when the prebundle build fails', async () => {
    await withTempDir('rstest-env-build-fallback-', async (root) => {
      const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {});
      const resolvedPath = createPackage(
        root,
        `import './missing-dependency.js';
export class JSDOM {}`,
      );

      try {
        const result = await prepareTestEnvironmentModules({
          projects: [
            createProject(root, { prebundle: true }),
            createProject(root, { prebundle: true }),
          ],
          rootPath: root,
        });

        try {
          expect(result.modules.get('jsdom')).toEqual({
            name: 'jsdom',
            packageName: 'jsdom',
            resolvedPath,
            bundlePath: undefined,
          });
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining(
              'Failed to load the test environment prebundle for "jsdom"',
            ),
          );
          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Error: Rspack build failed.'),
          );
        } finally {
          await result.cleanup();
        }
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('forces the prebundle outside the automatic version matrix', async () => {
    await withTempDir('rstest-env-force-', async (root) => {
      createPackage(root, 'export class JSDOM {}', { version: '31.0.0' });

      const result = await prepareTestEnvironmentModules({
        projects: [createProject(root, { prebundle: true })],
        rootPath: root,
      });

      try {
        expect(result.modules.get('jsdom')?.bundlePath).toBeTruthy();
      } finally {
        await result.cleanup();
      }
    });
  });

  it('updates the live module map when a synthetic environment is reused', async () => {
    await withTempDir('rstest-env-live-update-', async (root) => {
      createPackage(root, 'export class JSDOM {}');
      createPackage(root, 'export class Window {}', {
        name: 'happy-dom',
        version: '20.11.1',
      });
      const environmentName = 'default-environment-1';
      const result = await prepareTestEnvironmentModules({
        projects: [
          createProject(root, {
            environmentName: 'jsdom',
            prebundle: true,
          }),
        ].map((project) => ({ ...project, environmentName })),
        rootPath: root,
      });
      const liveModules = result.modules;

      try {
        expect(liveModules.get(environmentName)?.name).toBe('jsdom');

        await result.update(
          [
            createProject(root, {
              environmentName: 'happy-dom',
              prebundle: true,
            }),
          ].map((project) => ({ ...project, environmentName })),
        );

        expect(result.modules).toBe(liveModules);
        expect(liveModules.get(environmentName)).toMatchObject({
          name: 'happy-dom',
          packageName: 'happy-dom',
        });
        expect(liveModules.get(environmentName)?.bundlePath).toBeTruthy();
      } finally {
        await result.cleanup();
      }
    });
  });
});
