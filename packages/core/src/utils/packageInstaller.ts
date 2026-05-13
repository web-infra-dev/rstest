import { spawn as spawnProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolveCommand } from 'package-manager-detector/commands';
import { detect as detectPackageManager } from 'package-manager-detector/detect';
import { isTTY } from './helper';
import { color, logger } from './logger';

export type InstallPackageOptions = {
  confirm?: typeof import('@clack/prompts').confirm;
  detectPackageManager?: typeof detectPackageManager;
  message?: string;
  spawn?: typeof spawnProcess;
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

  const detect = options.detectPackageManager ?? detectPackageManager;
  const { agent = 'npm' } = (await detect({ cwd: root })) ?? {};
  const resolved = resolveCommand(agent, 'add', ['-D', packageName]);
  const command = resolved ?? {
    command: 'npm',
    args: ['install', '-D', packageName],
  };

  logger.log(color.cyan(`Installing ${packageName}...`));

  await new Promise<void>((resolve, reject) => {
    const spawn = options.spawn ?? spawnProcess;
    const child = spawn(command.command, command.args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command.command} ${command.args.join(' ')} failed.`));
    });
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
