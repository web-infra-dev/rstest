import { fileURLToPath } from 'node:url';
import { dirname } from 'pathe';
import {
  ensurePackageInstalled,
  isPackageInstalled,
  type InstallPackageOptions,
} from '../utils/packageInstaller';
import type { EnvironmentName } from '../types';
import { color } from '../utils';

export type EnvironmentDependencyName = Extract<
  EnvironmentName,
  'jsdom' | 'happy-dom'
>;

export const environmentDependencyPackages: Record<
  EnvironmentDependencyName,
  string
> = {
  jsdom: 'jsdom',
  'happy-dom': 'happy-dom',
};

const coreRoot = dirname(fileURLToPath(import.meta.url));

type PackageInstaller = (
  packageName: string,
  root: string,
  environmentName: string,
  options?: InstallPackageOptions,
) => Promise<boolean>;

type PackageInstalledChecker = (packageName: string, root: string) => boolean;

export const createTestEnvironmentLoadError = (
  packageName: string,
  root: string,
  environmentName: string,
): Error => {
  const error = new Error(
    `Failed to load testEnvironment "${environmentName}" dependency: ${color.cyan(packageName)} in ${color.underline(root)}, please make sure it is installed.\n`,
  );
  error.stack = '';
  return error;
};

export const formatTestEnvironmentPrebundleFallbackWarning = (
  packageName: string,
  reason: unknown,
): string =>
  `Failed to load the test environment prebundle for "${packageName}"; falling back to its native entry. The failed prebundle attempt adds startup overhead.\n${String(reason)}`;

export const installTestEnvironmentDependency = (
  packageName: string,
  root: string,
  environmentName: string,
  options: InstallPackageOptions = {},
): Promise<boolean> => {
  return ensurePackageInstalled(packageName, root, {
    ...options,
    message:
      options.message ??
      `${packageName} is required for testEnvironment "${environmentName}". Install it now?`,
  });
};

type ProjectWithTestEnvironment = {
  rootPath: string;
  normalizedConfig: {
    testEnvironment: {
      name: string;
    };
  };
};

type EnvironmentDependency = {
  environmentName: string;
  roots: Set<string>;
};

export const getTestEnvironmentResolutionRoots = (
  projectRoot: string,
  root: string,
): string[] => Array.from(new Set([projectRoot, root, coreRoot]));

export const ensureTestEnvironmentDependencies = async (
  projects: ProjectWithTestEnvironment[],
  root: string,
  options: InstallPackageOptions = {},
  installer: PackageInstaller = installTestEnvironmentDependency,
  isInstalled: PackageInstalledChecker = isPackageInstalled,
): Promise<void> => {
  const packages = new Map<string, EnvironmentDependency>();

  for (const project of projects) {
    const environmentName = project.normalizedConfig.testEnvironment.name;
    const packageName =
      environmentDependencyPackages[
        environmentName as EnvironmentDependencyName
      ];

    if (!packageName) {
      continue;
    }

    const roots = getTestEnvironmentResolutionRoots(project.rootPath, root);

    if (
      roots.some((resolutionRoot) => isInstalled(packageName, resolutionRoot))
    ) {
      continue;
    }

    const dependency = packages.get(packageName);
    if (dependency) {
      for (const resolutionRoot of roots) {
        dependency.roots.add(resolutionRoot);
      }
    } else {
      packages.set(packageName, {
        environmentName,
        roots: new Set(roots),
      });
    }
  }

  for (const [packageName, dependency] of packages) {
    await installer(packageName, root, dependency.environmentName, options);

    if (
      !Array.from(dependency.roots).some((resolutionRoot) =>
        isInstalled(packageName, resolutionRoot),
      )
    ) {
      throw createTestEnvironmentLoadError(
        packageName,
        root,
        dependency.environmentName,
      );
    }
  }
};
