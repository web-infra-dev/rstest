import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isTTY } from './helper';
import { color, logger } from './logger';

type PackageInstaller = (
  packageName: string,
  options: {
    cwd: string;
    dev: boolean;
    silent: boolean;
  },
) => Promise<unknown>;

export type InstallPackageOptions = {
  confirm?: typeof import('@clack/prompts').confirm;
  installPackage?: PackageInstaller;
  message?: string;
};

export function isPackageInstalled(packageName: string, root: string): boolean {
  const require = createRequire(pathToFileURL(root).toString());

  try {
    require.resolve(packageName, { paths: [root] });
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND'
    ) {
      return false;
    }
    throw error;
  }
}

export const installPackage = async (
  packageName: string,
  root: string,
  options: InstallPackageOptions = {},
): Promise<boolean> => {
  if (!isTTY('stdin')) {
    return false;
  }

  const confirm = options.confirm ?? (await import('@clack/prompts')).confirm;
  const shouldInstall = await confirm({
    message: options.message ?? `${packageName} is required. Install it now?`,
    initialValue: true,
  });

  if (shouldInstall !== true) {
    return false;
  }

  logger.log(color.cyan(`Installing ${packageName}...`));

  const installer =
    options.installPackage ??
    (await import('@antfu/install-pkg')).installPackage;
  await installer(packageName, {
    cwd: root,
    dev: true,
    silent: false,
  });

  return true;
};

export const ensurePackageInstalled = async (
  packageName: string,
  root: string,
  options: InstallPackageOptions = {},
): Promise<boolean> => {
  if (isPackageInstalled(packageName, root)) {
    return true;
  }

  await installPackage(packageName, root, options);

  return isPackageInstalled(packageName, root);
};
