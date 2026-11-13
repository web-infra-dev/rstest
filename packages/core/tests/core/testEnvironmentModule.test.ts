import { withTempDir } from '../helpers/tempDir';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import type {
  InternalProjectContext,
  TestEnvironmentPrebundle,
} from '../../src/types';
import {
  buildTestEnvironmentModule,
  prepareTestEnvironmentModules,
} from '../../src/core/environment/testEnvironmentModule';
import { logger } from '../../src/utils';

// The prebundle child entry only exists in the built package; build in-process
// so these tests keep exercising the source.
const prepare = (
  options: Parameters<typeof prepareTestEnvironmentModules>[0],
) =>
  prepareTestEnvironmentModules({
    buildModule: buildTestEnvironmentModule,
    ...options,
  });

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
): InternalProjectContext => {
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
  } as InternalProjectContext;
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
  const isJSDOM = name === 'jsdom';
  const [major = 0, minor = 0] = version.split('.').map(Number);
  const hasGeneratedIdlLayout =
    isJSDOM && (major > 30 || (major === 30 && minor >= 1));
  const entryPath = path.join(
    packageRoot,
    isJSDOM ? 'lib' : '',
    isJSDOM ? 'api.js' : 'index.js',
  );
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name,
      type,
      version,
      main: `./${path.relative(packageRoot, entryPath)}`,
      ...(packageExports ? { exports: packageExports } : {}),
    }),
  );
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, source);
  if (isJSDOM && major >= 29) {
    const blobPath = path.join(
      packageRoot,
      'lib',
      ...(hasGeneratedIdlLayout
        ? ['generated', 'idl']
        : ['jsdom', 'living', 'generated']),
      'Blob.js',
    );
    fs.mkdirSync(path.dirname(blobPath), { recursive: true });
    fs.writeFileSync(
      blobPath,
      type === 'commonjs'
        ? 'exports.convert = (_globalObject, wrapper) => wrapper;'
        : 'export const convert = (_globalObject, wrapper) => wrapper;',
    );
  }
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
      const projectJsdomPath = createPackage(
        projectRoot,
        `
const canvas = require('canvas');
exports.JSDOM = class JSDOM {};
exports.canvasToken = canvas.token;
`,
        { type: 'commonjs' },
      );

      const result = await prepare({
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
        expect(moduleReference.bundlePath).toBe(
          fs.realpathSync(moduleReference.bundlePath),
        );
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
        // The cache entry outlives the run.
        expect(bundlePath && fs.existsSync(bundlePath)).toBe(true);
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

      const result = await prepare({
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

      const result = await prepare({
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

      const result = await prepare({
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
          version: '22.0.0',
        },
      );

      const result = await prepare({
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

      const result = await prepare({
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

      const result = await prepare({
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

      const result = await prepare({
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

        const result = await prepare({
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

        const result = await prepare({
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
        version: '22.0.0',
      });

      const result = await prepare({
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

  it.for(['20.11.1', '21.0.0'])(
    'automatically creates a bundle for supported happy-dom %s',
    async (version) => {
      await withTempDir('rstest-env-supported-happy-dom-', async (root) => {
        createPackage(root, 'export class Window {}', {
          name: 'happy-dom',
          version,
        });

        const result = await prepare({
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
    },
  );

  it('forces the happy-dom prebundle outside the automatic version matrix', async () => {
    await withTempDir('rstest-env-force-happy-dom-', async (root) => {
      createPackage(root, 'export class Window {}', {
        name: 'happy-dom',
        version: '22.0.0',
      });

      const result = await prepare({
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

      const result = await prepare({
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

      const result = await prepare({
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

  it('uses automatic prebundle by default', async () => {
    await withTempDir('rstest-env-default-auto-', async (root) => {
      createPackage(root, 'export class JSDOM {}');

      const result = await prepare({
        projects: [createProject(root)],
        rootPath: root,
      });

      try {
        expect(result.modules.get('jsdom')).toMatchObject({
          name: 'jsdom',
        });
        expect(result.modules.get('jsdom')?.bundlePath).toBeTruthy();
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
        const result = await prepare({
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

  it('falls back to the native entry when the prebundle process crashes', async () => {
    await withTempDir('rstest-env-crash-fallback-', async (root) => {
      const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {});
      createPackage(root, 'export class JSDOM {}');

      try {
        const result = await prepare({
          projects: [createProject(root, { prebundle: true })],
          rootPath: root,
          buildModule: async () => {
            throw new Error('The prebundle process exited with SIGSEGV.');
          },
        });

        try {
          expect(result.modules.get('jsdom')?.bundlePath).toBeUndefined();
          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining(
              'The prebundle process exited with SIGSEGV.',
            ),
          );
        } finally {
          await result.cleanup();
        }
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('stops an in-flight prebundle process on cleanup without a fallback warning', async () => {
    await withTempDir('rstest-env-cleanup-child-', async (root) => {
      const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {});
      createPackage(root, 'export class JSDOM {}');

      try {
        const result = await prepare({
          projects: [],
          rootPath: root,
          buildModule: (_options, signal) =>
            new Promise((_resolve, reject) => {
              const stop = () => reject(signal.reason);
              if (signal.aborted) stop();
              else signal.addEventListener('abort', stop, { once: true });
            }),
        });
        const updating = result.update([
          createProject(root, { prebundle: true }),
        ]);
        await result.cleanup();
        await updating;
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('forces the prebundle outside the automatic version matrix', async () => {
    await withTempDir('rstest-env-force-', async (root) => {
      createPackage(root, 'export class JSDOM {}', { version: '31.0.0' });

      const result = await prepare({
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
      const result = await prepare({
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

describe('prebundle cache', () => {
  const cacheDirectory = (root: string): string =>
    path.join(root, 'node_modules', '.cache', 'rstest-test-environments');

  const listEntries = (root: string): string[] => {
    const base = cacheDirectory(root);
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base)
      .filter((name) => !name.startsWith('.'))
      .flatMap((key) =>
        fs
          .readdirSync(path.join(base, key))
          .map((generation) => path.join(base, key, generation)),
      );
  };

  const createCountingBuilder = () => {
    const calls: string[] = [];
    const buildModule: NonNullable<
      Parameters<typeof prepareTestEnvironmentModules>[0]['buildModule']
    > = (options) => {
      calls.push(options.environmentRoot);
      return buildTestEnvironmentModule(options);
    };
    return { calls, buildModule };
  };

  const createDependencyPackage = (root: string, token: string) => {
    const entry = createPackage(
      root,
      `import { token } from './dep.js';
export class JSDOM {}
export const dependencyToken = token;
`,
    );
    const dependencyPath = path.join(path.dirname(entry), 'dep.js');
    fs.writeFileSync(
      dependencyPath,
      `export const token = ${JSON.stringify(token)};`,
    );
    return dependencyPath;
  };

  const prepareOnce = async (
    root: string,
    buildModule: Parameters<
      typeof prepareTestEnvironmentModules
    >[0]['buildModule'],
  ) => {
    const result = await prepareTestEnvironmentModules({
      buildModule,
      projects: [createProject(root, { prebundle: true })],
      rootPath: root,
    });
    const bundlePath = result.modules.get('jsdom')?.bundlePath;
    if (!bundlePath) {
      await result.cleanup();
      throw new Error('Expected jsdom to be bundled.');
    }
    return { bundlePath, cleanup: result.cleanup };
  };

  it('reuses the cached bundle on a second prepare and keeps it across cleanup', async () => {
    await withTempDir('rstest-env-cache-reuse-', async (root) => {
      createDependencyPackage(root, 'one');
      const { calls, buildModule } = createCountingBuilder();

      const first = await prepareOnce(root, buildModule);
      expect(
        first.bundlePath.startsWith(cacheDirectory(fs.realpathSync(root))),
      ).toBe(true);
      expect(first.bundlePath.split(path.sep)).toContain('node_modules');
      await first.cleanup();
      expect(fs.existsSync(first.bundlePath)).toBe(true);

      const second = await prepareOnce(root, buildModule);
      try {
        expect(calls).toHaveLength(1);
        expect(second.bundlePath).toBe(first.bundlePath);
        const bundled = await import(pathToFileURL(second.bundlePath).href);
        expect(bundled.dependencyToken).toBe('one');
      } finally {
        await second.cleanup();
      }

      expect(fs.existsSync(second.bundlePath)).toBe(true);
      expect(listEntries(root)).toHaveLength(1);
      expect(
        fs
          .readdirSync(cacheDirectory(root))
          .filter((name) => name.startsWith('.')),
      ).toEqual([]);
    });
  });

  it('publishes a new entry when a bundled dependency file changes', async () => {
    await withTempDir('rstest-env-cache-dependency-', async (root) => {
      const dependencyPath = createDependencyPackage(root, 'one');
      const past = (secondsAgo: number) =>
        new Date(Date.now() - secondsAgo * 1000);
      fs.utimesSync(dependencyPath, past(120), past(120));
      const { calls, buildModule } = createCountingBuilder();

      const first = await prepareOnce(root, buildModule);
      await first.cleanup();
      expect(listEntries(root)).toHaveLength(1);

      // Same size, different mtime.
      fs.writeFileSync(dependencyPath, 'export const token = "two";');
      fs.utimesSync(dependencyPath, past(60), past(60));
      const second = await prepareOnce(root, buildModule);
      try {
        expect(calls).toHaveLength(2);
        expect(second.bundlePath).not.toBe(first.bundlePath);
        const bundled = await import(pathToFileURL(second.bundlePath).href);
        expect(bundled.dependencyToken).toBe('two');
      } finally {
        await second.cleanup();
      }
      expect(listEntries(root)).toHaveLength(2);

      // Different size, same mtime.
      fs.writeFileSync(dependencyPath, 'export const token = "three-3";');
      fs.utimesSync(dependencyPath, past(60), past(60));
      const third = await prepareOnce(root, buildModule);
      try {
        expect(calls).toHaveLength(3);
        expect(fs.readFileSync(third.bundlePath, 'utf8')).toContain('three-3');
      } finally {
        await third.cleanup();
      }
      expect(listEntries(root)).toHaveLength(3);
    });
  });

  it('does not cache a build whose input has a future mtime', async () => {
    await withTempDir('rstest-env-cache-future-', async (root) => {
      const dependencyPath = createDependencyPackage(root, 'one');
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(dependencyPath, future, future);
      const debug = rs.spyOn(logger, 'debug').mockImplementation(() => {});
      const { calls, buildModule } = createCountingBuilder();

      try {
        const result = await prepareOnce(root, buildModule);
        try {
          expect(listEntries(root)).toEqual([]);
          expect(debug).toHaveBeenCalledWith(
            expect.stringContaining('will not be cached'),
          );
          const bundled = await import(pathToFileURL(result.bundlePath).href);
          expect(bundled.dependencyToken).toBe('one');
        } finally {
          await result.cleanup();
        }
        expect(fs.existsSync(result.bundlePath)).toBe(false);

        await (await prepareOnce(root, buildModule)).cleanup();
        expect(calls).toHaveLength(2);
      } finally {
        debug.mockRestore();
      }
    });
  });

  it('rebuilds when the package version changes', async () => {
    await withTempDir('rstest-env-cache-version-', async (root) => {
      createPackage(root, 'export class JSDOM {}', { version: '30.0.1' });
      const { calls, buildModule } = createCountingBuilder();
      await (await prepareOnce(root, buildModule)).cleanup();

      // Identical files and sizes: only the declared version differs.
      const manifestPath = path.join(
        root,
        'node_modules',
        'jsdom',
        'package.json',
      );
      const manifest = fs
        .readFileSync(manifestPath, 'utf8')
        .replace('30.0.1', '30.0.2');
      fs.writeFileSync(manifestPath, manifest);
      await (await prepareOnce(root, buildModule)).cleanup();

      expect(calls).toHaveLength(2);
    });
  });

  it('rebuilds when an optional native dependency becomes resolvable', async () => {
    await withTempDir('rstest-env-cache-optional-', async (root) => {
      createPackage(
        root,
        `let installed = false;
try {
  require.resolve('canvas');
  installed = true;
} catch {}
if (installed) {
  require('canvas');
}
exports.JSDOM = class JSDOM {};
exports.canvasInstalled = installed;
`,
        { type: 'commonjs', version: '15.2.0' },
      );
      const { calls, buildModule } = createCountingBuilder();
      await (await prepareOnce(root, buildModule)).cleanup();
      await (await prepareOnce(root, buildModule)).cleanup();
      expect(calls).toHaveLength(1);

      createPackage(root, 'exports.token = "canvas";', {
        name: 'canvas',
        type: 'commonjs',
      });
      await (await prepareOnce(root, buildModule)).cleanup();
      expect(calls).toHaveLength(2);
    });
  });

  it.each([
    [
      'a truncated bundle',
      (entry: string) =>
        fs.truncateSync(path.join(entry, 'dist', 'environment.mjs'), 10),
    ],
    [
      'a missing bundle',
      (entry: string) => fs.rmSync(path.join(entry, 'dist', 'environment.mjs')),
    ],
    [
      'an unparsable manifest',
      (entry: string) =>
        fs.writeFileSync(path.join(entry, 'manifest.json'), '{'),
    ],
    [
      'a missing manifest',
      (entry: string) => fs.rmSync(path.join(entry, 'manifest.json')),
    ],
  ])('ignores %s and rebuilds', async (_name, damage) => {
    await withTempDir('rstest-env-cache-corrupt-', async (root) => {
      createDependencyPackage(root, 'one');
      const { calls, buildModule } = createCountingBuilder();
      await (await prepareOnce(root, buildModule)).cleanup();
      const [entry] = listEntries(root);
      damage(entry!);

      const result = await prepareOnce(root, buildModule);
      try {
        expect(calls).toHaveLength(2);
        const bundled = await import(pathToFileURL(result.bundlePath).href);
        expect(bundled.dependencyToken).toBe('one');
      } finally {
        await result.cleanup();
      }
    });
  });

  it('keeps every published entry valid when two prepares of one key race', async () => {
    await withTempDir('rstest-env-cache-concurrent-', async (root) => {
      createDependencyPackage(root, 'one');
      const { calls, buildModule } = createCountingBuilder();

      const [a, b] = await Promise.all([
        prepareOnce(root, buildModule),
        prepareOnce(root, buildModule),
      ]);
      try {
        expect(calls).toHaveLength(2);
        for (const { bundlePath } of [a, b]) {
          const bundled = await import(pathToFileURL(bundlePath).href);
          expect(bundled.dependencyToken).toBe('one');
        }
      } finally {
        await a.cleanup();
        await b.cleanup();
      }

      // Each publisher has its own entry; a later run uses one of them.
      const entries = listEntries(root);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.length).toBeLessThanOrEqual(2);
      expect(
        fs
          .readdirSync(cacheDirectory(root))
          .filter((name) => name.startsWith('.')),
      ).toEqual([]);
      const third = await prepareOnce(root, buildModule);
      await third.cleanup();
      expect(calls).toHaveLength(2);
    });
  });

  it('refreshes the last-used time of its entries when watch mode updates', async () => {
    await withTempDir('rstest-env-cache-touch-', async (root) => {
      createDependencyPackage(root, 'one');
      const result = await prepareTestEnvironmentModules({
        buildModule: buildTestEnvironmentModule,
        projects: [createProject(root, { prebundle: true })],
        rootPath: root,
      });
      try {
        const [entry] = listEntries(root);
        const old = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
        fs.utimesSync(entry!, old, old);
        await result.update([createProject(root, { prebundle: true })]);
        expect(fs.statSync(entry!).mtimeMs).toBeGreaterThan(
          old.getTime() + 1000,
        );
      } finally {
        await result.cleanup();
      }
    });
  });

  it('falls back to a temporary directory when the cache directory cannot be created', async () => {
    await withTempDir('rstest-env-cache-blocked-', async (root) => {
      createDependencyPackage(root, 'one');
      // A file where the cache's parent directory belongs makes `mkdir` fail
      // for any user, including root.
      fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(root, 'node_modules', '.cache'), '');
      const { calls, buildModule } = createCountingBuilder();

      const result = await prepareOnce(root, buildModule);
      const { bundlePath } = result;
      try {
        expect(bundlePath.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
        expect(bundlePath.split(path.sep)).toContain('node_modules');
        const bundled = await import(pathToFileURL(bundlePath).href);
        expect(bundled.dependencyToken).toBe('one');
      } finally {
        await result.cleanup();
      }
      expect(calls).toHaveLength(1);
      expect(fs.existsSync(bundlePath)).toBe(false);
    });
  });

  it('falls back to a temporary directory when the cache directory is read-only', async () => {
    await withTempDir('rstest-env-cache-readonly-', async (root) => {
      createDependencyPackage(root, 'one');
      const modules = path.join(root, 'node_modules');
      fs.chmodSync(modules, 0o555);
      try {
        // Root and Windows ignore the mode; there is nothing to test there.
        const canStillWrite = (() => {
          try {
            fs.mkdirSync(path.join(modules, '.probe'));
            return true;
          } catch {
            return false;
          }
        })();
        if (canStillWrite) {
          return;
        }

        const { calls, buildModule } = createCountingBuilder();
        const result = await prepareOnce(root, buildModule);
        try {
          expect(
            result.bundlePath.startsWith(fs.realpathSync(os.tmpdir())),
          ).toBe(true);
          const bundled = await import(pathToFileURL(result.bundlePath).href);
          expect(bundled.dependencyToken).toBe('one');
        } finally {
          await result.cleanup();
        }
        expect(calls).toHaveLength(1);
        expect(fs.existsSync(result.bundlePath)).toBe(false);
      } finally {
        fs.chmodSync(modules, 0o755);
      }
    });
  });

  it('does not cache a bundle whose build recorded no manifest', async () => {
    await withTempDir('rstest-env-cache-no-manifest-', async (root) => {
      createPackage(root, 'export class JSDOM {}');
      const result = await prepareOnce(root, async ({ environmentRoot }) => {
        const bundlePath = path.join(
          environmentRoot,
          'dist',
          'environment.mjs',
        );
        fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
        fs.writeFileSync(bundlePath, 'export class JSDOM {}');
        return fs.realpathSync(bundlePath);
      });
      expect(fs.existsSync(result.bundlePath)).toBe(true);
      expect(listEntries(root)).toEqual([]);
      await result.cleanup();
      expect(fs.existsSync(result.bundlePath)).toBe(false);
      expect(
        fs
          .readdirSync(cacheDirectory(root))
          .filter((name) => name.startsWith('.tmp-')),
      ).toEqual([]);
    });
  });
});
