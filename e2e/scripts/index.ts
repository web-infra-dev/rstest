import fs from 'node:fs';
import path from 'node:path';
import {
  expect,
  onTestFailed as onRstestFailed,
  onTestFinished as onRstestFinished,
} from '@rstest/core';
import stripAnsi from 'strip-ansi';
import type { Options, Result } from 'tinyexec';
import { x } from 'tinyexec';

type IoType = 'stdout' | 'stderr';
class Cli {
  public exec: Result;
  public stdout = '';
  public stderr = '';
  public log = '';
  private stdoutListeners: Array<() => void> = [];
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
      this.log += processStd ?? '';
      for (const listener of this.stdoutListeners) {
        listener();
      }
    });

    this.exec.process?.stderr?.on('data', (data) => {
      const processStd = strip ? stripAnsi(data.toString()) : data.toString();
      this.stderr += processStd ?? '';
      this.log += processStd ?? '';
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
  onTestFailed = onRstestFailed,
}: {
  command: string;
  options?: Partial<Options>;
  args?: string[];
  onTestFinished?: (fn: () => void | Promise<void>) => void;
  onTestFailed?: typeof onRstestFailed;
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

  onTestFailed?.(({ task }) => {
    if (task.result?.errors?.[0]) {
      task.result.errors![0]!.message +=
        `\n\n--- CLI Log Start ---\n${cli.log}\n--- CLI Log End ---\n`;
    }
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
    expect(exitCode).toBe(0);
  };

  const expectExecFailed = async () => {
    await cli.exec;
    const exitCode = cli.exec.process?.exitCode;
    if (exitCode === 0) {
      const logs = cli.stdout.split('\n').filter(Boolean);
      throw new Error(
        `expect test failed but passed. Logs:\n\n${logs.join('\n')}`,
      );
    }
    expect(exitCode).not.toBe(0);
  };

  const expectLog = (
    msg: string | RegExp,
    logs: string[] = cli.stdout.split('\n').filter(Boolean),
  ) => {
    const matchedLog = logs.find((log) => {
      if (typeof msg === 'string') {
        return log.includes(msg);
      }
      return log.match(msg);
    });

    if (!matchedLog) {
      throw new Error(`Can't find log(${msg}) in:\n${logs.join('\n')}`);
    }
  };

  const expectStderrLog = (
    msg: string | RegExp,
    logs: string[] = cli.stderr.split('\n').filter(Boolean),
  ) => {
    expectLog(msg, logs);
  };

  return {
    cli,
    expectExecSuccess,
    expectExecFailed,
    expectLog,
    expectStderrLog,
  };
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
