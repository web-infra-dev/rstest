import { pathToFileURL } from 'node:url';
import type { TestEnvironmentModuleReference } from '../../../types';
import { logger } from '../../../utils';
import { finalizeDynamicImport } from '../resolveDynamicImport';

type JSDOMModule = typeof import('jsdom');
type HappyDOMModule = typeof import('happy-dom');

export type LoadedTestEnvironmentModule =
  | {
      name: 'jsdom';
      module: JSDOMModule;
    }
  | {
      name: 'happy-dom';
      module: HappyDOMModule;
    };

const moduleCache = new Map<string, Promise<LoadedTestEnvironmentModule>>();
const requiredJSDOMExports = ['CookieJar', 'JSDOM', 'VirtualConsole'] as const;

const importModule = async (modulePath: string): Promise<unknown> => {
  return finalizeDynamicImport({
    modulePath: pathToFileURL(modulePath).href,
    importAttributes: {},
    interopDefault: true,
  });
};

const validateBuiltinDependency = (
  reference: TestEnvironmentModuleReference,
  modulePath: string,
  loaded: unknown,
): LoadedTestEnvironmentModule => {
  const module = loaded as Record<string, unknown>;

  if (
    reference.name === 'jsdom' &&
    requiredJSDOMExports.every((name) => typeof module[name] === 'function')
  ) {
    return {
      name: 'jsdom',
      // The runtime shape is checked above; the cast preserves package types
      // without duplicating every jsdom export in this internal wire adapter.
      module: module as JSDOMModule,
    };
  }

  if (
    reference.name === 'happy-dom' &&
    (typeof module.GlobalWindow === 'function' ||
      typeof module.Window === 'function')
  ) {
    return {
      name: 'happy-dom',
      // See the jsdom branch: validation owns the runtime boundary.
      module: module as HappyDOMModule,
    };
  }

  const expectedExports =
    reference.name === 'jsdom'
      ? requiredJSDOMExports.join(', ')
      : 'GlobalWindow or Window';
  throw new Error(
    `Invalid ${reference.packageName} test environment dependency loaded from ${modulePath}. Expected exports: ${expectedExports}.`,
  );
};

const probeBundledDependency = (loaded: LoadedTestEnvironmentModule): void => {
  if (loaded.name !== 'jsdom') {
    return;
  }

  const dom = new loaded.module.JSDOM('<!doctype html><html></html>');
  try {
    // A bundle can import successfully while changing CommonJS resolution or
    // losing jsdom's runtime CSS asset. Probe that path before test setup so a
    // broken bundle falls back to the user's native jsdom entry.
    dom.window.getComputedStyle(dom.window.document.documentElement);
  } finally {
    dom.window.close();
  }
};

const loadModule = async (
  reference: TestEnvironmentModuleReference,
): Promise<LoadedTestEnvironmentModule> => {
  if (reference.bundlePath) {
    try {
      const loaded = validateBuiltinDependency(
        reference,
        reference.bundlePath,
        await importModule(reference.bundlePath),
      );
      probeBundledDependency(loaded);
      logger.debug(`loaded bundled test environment ${reference.packageName}`);
      return loaded;
    } catch (error) {
      logger.debug(
        `Failed to load bundled test environment ${reference.packageName}; falling back to its native entry: ${String(error)}`,
      );
    }
  }

  return validateBuiltinDependency(
    reference,
    reference.resolvedPath,
    await importModule(reference.resolvedPath),
  );
};

export const loadTestEnvironmentModule = (
  reference: TestEnvironmentModuleReference | undefined,
): Promise<LoadedTestEnvironmentModule | undefined> => {
  if (!reference) {
    return Promise.resolve(undefined);
  }

  const cacheKey = [
    reference.name,
    reference.bundlePath,
    reference.resolvedPath,
  ].join('\0');
  let loaded = moduleCache.get(cacheKey);
  if (!loaded) {
    loaded = loadModule(reference);
    moduleCache.set(cacheKey, loaded);
  }
  return loaded;
};
