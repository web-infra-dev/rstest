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

const importModule = async (modulePath: string): Promise<unknown> => {
  return finalizeDynamicImport({
    modulePath: pathToFileURL(modulePath).href,
    importAttributes: {},
    interopDefault: true,
  });
};

const validateBuiltinDependency = (
  reference: TestEnvironmentModuleReference,
  loaded: unknown,
): LoadedTestEnvironmentModule => {
  const module = loaded as Record<string, unknown>;

  if (reference.name === 'jsdom' && typeof module.JSDOM === 'function') {
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

  throw new Error(
    `Invalid ${reference.packageName} test environment dependency exports.`,
  );
};

const loadModule = async (
  reference: TestEnvironmentModuleReference,
): Promise<LoadedTestEnvironmentModule> => {
  if (reference.bundlePath) {
    try {
      const loaded = validateBuiltinDependency(
        reference,
        await importModule(reference.bundlePath),
      );
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
