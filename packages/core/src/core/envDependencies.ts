import {
  ensurePackageInstalled,
  isPackageInstalled,
  type InstallPackageOptions,
} from '../utils/packageInstaller';
import type { EnvironmentName } from '../types';

const EnvironmentDependencyMap: Partial<Record<EnvironmentName, string>> = {
  jsdom: 'jsdom',
  'happy-dom': 'happy-dom',
};

type PackageInstaller = (
  packageName: string,
  root: string,
  environmentName: string,
  options?: InstallPackageOptions,
) => Promise<boolean>;

type PackageInstalledChecker = (packageName: string, root: string) => boolean;

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

export const ensureTestEnvironmentDependencies = async (
  projects: ProjectWithTestEnvironment[],
  root: string,
  options: InstallPackageOptions = {},
  installer: PackageInstaller = installTestEnvironmentDependency,
  isInstalled: PackageInstalledChecker = isPackageInstalled,
): Promise<void> => {
  const packages = new Map<string, string>();

  for (const project of projects) {
    const environmentName = project.normalizedConfig.testEnvironment.name;
    const packageName =
      EnvironmentDependencyMap[environmentName as EnvironmentName];

    if (!packageName) {
      continue;
    }

    if (
      isInstalled(packageName, project.rootPath) ||
      (project.rootPath !== root && isInstalled(packageName, root))
    ) {
      continue;
    }

    packages.set(packageName, environmentName);
  }

  for (const [packageName, environmentName] of packages) {
    await installer(packageName, root, environmentName, options);
  }
};
