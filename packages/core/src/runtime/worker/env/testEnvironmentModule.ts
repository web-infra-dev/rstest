import { pathToFileURL } from 'node:url';
import type { TestEnvironmentModuleFallback } from '../../../pool/protocol';
import type { TestEnvironmentModuleReference } from '../../../types';
import { logger } from '../../../utils';
import { finalizeDynamicImport } from '../resolveDynamicImport';
import {
  type LoadedTestEnvironmentModule,
  probeBundledDependency,
  validateBuiltinDependency,
} from './testEnvironmentProbe';

export type { LoadedTestEnvironmentModule };

const moduleCache = new Map<string, Promise<LoadedTestEnvironmentModule>>();

const importModule = async (modulePath: string): Promise<unknown> => {
  return finalizeDynamicImport({
    modulePath: pathToFileURL(modulePath).href,
    importAttributes: {},
    interopDefault: true,
  });
};

const loadModule = async (
  reference: TestEnvironmentModuleReference,
  onFallback?: (fallback: TestEnvironmentModuleFallback) => void,
): Promise<LoadedTestEnvironmentModule> => {
  if (reference.bundlePath) {
    try {
      const loaded = validateBuiltinDependency(
        reference,
        reference.bundlePath,
        await importModule(reference.bundlePath),
      );
      probeBundledDependency(loaded, reference.bundlePath);
      logger.debug(`loaded bundled test environment ${reference.packageName}`);
      return loaded;
    } catch (error) {
      const reason = String(error);
      logger.debug(
        `Failed to load bundled test environment ${reference.packageName}; falling back to its native entry: ${reason}`,
      );
      onFallback?.({
        packageName: reference.packageName,
        bundlePath: reference.bundlePath,
        resolvedPath: reference.resolvedPath,
        reason,
      });
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
  onFallback?: (fallback: TestEnvironmentModuleFallback) => void,
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
    loaded = loadModule(reference, onFallback);
    moduleCache.set(cacheKey, loaded);
  }
  return loaded;
};
