import fs from 'node:fs';
import path from 'node:path';
import { onTestFinished as onRstestFinished } from '@rstest/core';
import stripAnsi from 'strip-ansi';
import type { Options, Result } from 'tinyexec';
import { x } from 'tinyexec';

type IoType = 'stdout' | 'stderr';
class Cli {
  public exec: Result;
  public stdout = '';
  public stderr = '';
  private stdoutListeners: Array<() => void> = [];
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: will use it
  private stderrListeners: Array<() => void> = [];

  constructor(
    exec: Result,
    options?: {
      stripAnsi?: boolean;
    },
  ) {
    this.exec = exec;
    const strip = options?.stripAnsi ?? true;
    this.exec.process?.stdout?.on('data', (data) => {
      const processStd = strip ? stripAnsi(data.toString()) : data.toString();
      this.stdout += processStd ?? '';
      for (const listener of this.stdoutListeners) {
        listener();
      }
    });

    this.exec.process?.stderr?.on('data', (data) => {
      const processStd = strip ? stripAnsi(data.toString()) : data.toString();
      this.stderr += processStd ?? '';
      for (const listener of this.stdoutListeners) {
        listener();
      }
    });
  }

  resetStd = (std?: IoType) => {
    const toReset: IoType[] = std ? [std] : ['stdout', 'stderr'];
    for (const io of toReset) {
      this[io] = '';
    }
  };

  private waitForStd = (expect: string | RegExp, io: IoType): Promise<void> => {
    return new Promise((resolve) => {
      this[`${io}Listeners`].push(() => {
        if (typeof expect === 'string') {
          if (this[io].includes(expect)) {
            resolve(undefined);
          }
        } else {
          if (this[io].match(expect)) {
            resolve(undefined);
          }
        }
      });
    });
  };

  waitForStdout(expect: string | RegExp) {
    return this.waitForStd(expect, 'stdout');
  }

  waitForStderr(expect: string | RegExp) {
    return this.waitForStd(expect, 'stderr');
  }
}

export async function runRstestCli({
  command,
  options,
  args = [],
  onTestFinished = onRstestFinished,
}: {
  command: string;
  options?: Partial<Options>;
  args?: string[];
  onTestFinished?: (fn: () => void | Promise<void>) => void;
}) {
  const process = x(command, args, {
    ...options,
    nodeOptions: {
      ...(options?.nodeOptions || {}),
      env: {
        ...(options?.nodeOptions?.env || {}),
        GITHUB_ACTIONS: 'false',
      },
    },
  } as Options);
  const cli = new Cli(process);

  onTestFinished(() => {
    !cli.exec.killed && cli.exec.kill();
  });

  const expectExecSuccess = async () => {
    await cli.exec;
    const exitCode = cli.exec.process?.exitCode;
    if (exitCode !== 0) {
      const logs = cli.stdout.split('\n').filter(Boolean);
      throw new Error(
        `Test failed with exit code ${exitCode}. Logs:\n\n${logs.join('\n')}`,
      );
    }
  };

  const expectLog = (
    msg: string,
    logs: string[] = cli.stdout.split('\n').filter(Boolean),
  ) => {
    const matchedLog = logs.find((log) => log.includes(msg));

    if (!matchedLog) {
      throw new Error(`Can't find log(${msg}) in:\n${logs.join('\n')}`);
    }
  };

  return { cli, expectExecSuccess, expectLog };
}

export async function prepareFixtures({
  fixturesPath,
  fixturesTargetPath,
}: {
  fixturesPath: string;
  fixturesTargetPath?: string;
}) {
  const root = path.dirname(fixturesPath);
  const distPath = fixturesTargetPath || path.resolve(`${fixturesPath}-test`);
  fs.rmSync(distPath, { recursive: true, force: true });
  await fs.promises.mkdir(distPath, { recursive: true });
  await fs.promises.cp(fixturesPath, distPath, {
    recursive: true,
    force: true,
  });

  const update = (
    relativePath: string,
    content: string | ((raw: string) => string),
  ) => {
    const targetFilepath = path.resolve(root, relativePath);
    let newContent = content;
    if (typeof content === 'function') {
      const oldContent = fs.readFileSync(targetFilepath, 'utf-8');
      newContent = content(oldContent);
    } else {
      newContent = content;
    }

    fs.writeFileSync(targetFilepath, newContent, 'utf-8');
  };

  const remove = (filePath: string) => {
    const targetFilepath = path.resolve(root, filePath);
    fs.rmSync(targetFilepath, { recursive: true, force: true });
  };

  const create = (filePath: string, content: string) => {
    fs.writeFileSync(path.resolve(root, filePath), content, 'utf-8');
  };

  const read = (relativePath: string) => {
    const targetFilepath = path.resolve(root, relativePath);
    const content = fs.readFileSync(targetFilepath, 'utf-8');
    return content;
  };

  const rename = (oldPath: string, newPath: string) => {
    const relativePath = path.relative(root, oldPath);
    if (oldPath === relativePath) {
      const newRelativePath = path.relative(root, newPath);
      const oldAbsPath = path.join(root, relativePath);
      const newAbsPath = path.join(root, newRelativePath);
      fs.renameSync(oldAbsPath, newAbsPath);
    }
  };

  return {
    fs: {
      create,
      update,
      read,
      delete: remove,
      rename,
    },
  };
}

export * from './utils';
