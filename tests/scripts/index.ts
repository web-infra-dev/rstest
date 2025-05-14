import fs from 'node:fs';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import type { Options, Result } from 'tinyexec';
import { x } from 'tinyexec';

type IoType = 'stdout' | 'stderr';
class Cli {
  public exec: Result;
  public stdout = '';
  public stderr = '';
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

  waitForStdout = (expect: string | RegExp) => {
    return this.waitForStd(expect, 'stdout');
  };

  waitForStderr = (expect: string | RegExp) => {
    return this.waitForStd(expect, 'stderr');
  };
}

export async function runRstestCli({
  command,
  options,
  args = [],
}: { command: string; options?: Partial<Options>; args?: string[] }) {
  const process = x(command, args, options as Options);
  const cli = new Cli(process);
  return { cli };
}

export async function prepareFixtures({
  fixturesPath,
}: { fixturesPath: string }) {
  const root = path.dirname(fixturesPath);
  const distPath = path.resolve(`${fixturesPath}-test`);
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
