import type { CoverageOptions } from '../types/coverage';
import { color } from '../utils';
import {
  installPackage,
  isPackageInstalled,
  type InstallPackageOptions,
} from '../utils/packageInstaller';

export const CoverageProviderMap: Record<string, string> = {
  istanbul: '@rstest/coverage-istanbul',
  v8: '@rstest/coverage-v8',
};

type CoverageProviderInstaller = (
  moduleName: string,
  root: string,
) => Promise<boolean>;
export const installCoverageProvider = async (
  moduleName: string,
  root: string,
  options: InstallPackageOptions = {},
): Promise<boolean> => {
  const packageName = moduleName.startsWith('@rstest/')
    ? `${moduleName}@${RSTEST_VERSION}`
    : moduleName;

  return installPackage(packageName, root, {
    ...options,
    message:
      options.message ??
      `${moduleName} is required for coverage. Install it now?`,
  });
};

export const getCoverageProviderModuleName = (
  options: CoverageOptions,
): string => {
  const moduleName = CoverageProviderMap[options.provider || 'istanbul'];
  if (!moduleName) {
    throw new Error(`Unknown coverage provider: ${options.provider}`);
  }
  return moduleName;
};

export const createCoverageProviderLoadError = (
  moduleName: string,
  root: string,
): Error => {
  const error = new Error(
    `Failed to load coverage provider module: ${color.cyan(moduleName)} in ${color.underline(root)}, please make sure it is installed.\n`,
  );
  error.stack = '';
  return error;
};

export const ensureCoverageProviderInstalled = async (
  options: CoverageOptions,
  root: string,
  installer: CoverageProviderInstaller = installCoverageProvider,
): Promise<void> => {
  if (!options.enabled) {
    return;
  }

  const moduleName = getCoverageProviderModuleName(options);
  if (isPackageInstalled(moduleName, root)) {
    return;
  }

  await installer(moduleName, root);

  if (!isPackageInstalled(moduleName, root)) {
    throw createCoverageProviderLoadError(moduleName, root);
  }
};
