import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import type { Rspack } from '@rsbuild/core';
import { dirname, join, relative, resolve } from 'pathe';
import { logger } from './logger';
import type { TraceEvent } from './trace';

// cspell:ignore mountinfo

export type RssTrace = {
  record: (event: string, args?: TraceEvent['args']) => void;
  close: () => void;
};

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    // cgroup files can be unavailable or disappear during container teardown.
    return undefined;
  }
}

function getCgroupDirectory(): string | undefined {
  if (process.platform !== 'linux') return undefined;
  const group = readText('/proc/self/cgroup')
    ?.split('\n')
    .find((line) => line.startsWith('0::'))
    ?.slice(3);
  if (group === undefined) return undefined;

  for (const line of readText('/proc/self/mountinfo')?.split('\n') ?? []) {
    if (!line.includes(' - cgroup2 ')) continue;
    const fields = line.split(' ');
    const decode = (value: string) =>
      value.replace(/\\([0-7]{3})/g, (_, code: string) =>
        String.fromCharCode(Number.parseInt(code, 8)),
      );
    const root = decode(fields[3]!);
    const mount = decode(fields[4]!);
    const subpath = relative(root, group);
    const candidates = subpath.startsWith('..')
      ? [mount]
      : [resolve(mount, subpath), mount];
    for (const candidate of candidates) {
      if (readText(join(candidate, 'memory.current')) !== undefined) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function createRssTrace(
  rootPath: string,
  embedded: boolean,
): RssTrace | undefined {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(
    rootPath,
    '.rstest',
    `trace-rss-${stamp}-${process.pid}.jsonl`,
  );
  let fd: number;
  try {
    mkdirSync(dirname(path), { recursive: true });
    fd = openSync(path, 'ax');
  } catch (error) {
    logger.warn(`Could not start RSS trace: ${String(error)}`);
    return undefined;
  }

  const cgroup = getCgroupDirectory();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    try {
      closeSync(fd);
    } catch (error) {
      logger.warn(`Could not close RSS trace: ${String(error)}`);
    }
  };
  const record: RssTrace['record'] = (event, args) => {
    if (closed) return;
    try {
      const worker = args?.role === 'worker';
      const memory = worker ? undefined : process.memoryUsage();
      const sampleCgroup =
        cgroup &&
        !worker &&
        (event === 'start' ||
          event === 'sample' ||
          event === 'stop' ||
          event === 'run:error');
      const cgroupMemory: Record<string, number | string | undefined> = {};
      if (sampleCgroup) {
        for (const name of ['current', 'max', 'peak']) {
          const value = readText(join(cgroup, `memory.${name}`));
          if (value !== undefined)
            cgroupMemory[name] = value === 'max' ? value : Number(value);
        }
        const events = readText(join(cgroup, 'memory.events'));
        for (const name of ['oom', 'oom_kill']) {
          const value = events
            ?.split('\n')
            .find((line) => line.startsWith(`${name} `))
            ?.split(' ')[1];
          if (value !== undefined) cgroupMemory[name] = Number(value);
        }
      }
      // Each complete line reaches the OS before execution continues, including
      // before a synchronous transform or a later SIGKILL can stop the process.
      writeSync(
        fd,
        `${JSON.stringify({
          time: new Date().toISOString(),
          pid: process.pid,
          event,
          role: 'host',
          ...memory,
          ...(sampleCgroup ? { cgroup: cgroupMemory } : {}),
          ...args,
        })}\n`,
      );
    } catch (error) {
      close();
      logger.warn(`RSS trace stopped: ${String(error)}`);
    }
  };
  timer = setInterval(() => record('sample'), 1000);
  timer.unref();
  record('start', { node: process.version, cgroupPath: cgroup });
  if (closed) return undefined;
  if (!embedded) logger.log(`RSS trace file: ${path}`);
  return {
    record,
    close: () => {
      record('stop');
      close();
    },
  };
}

export async function recordProjectAssets(
  compilation: Rspack.Compilation,
  project: string,
  record: RssTrace['record'],
): Promise<void> {
  try {
    const outputPath = compilation.compiler.outputPath;
    const outputFileSystem = compilation.compiler.outputFileSystem;
    const assets = compilation.getAssets();
    const sizes = {
      assetCount: assets.length,
      jsBytes: 0,
      sourceMapBytes: 0,
      otherBytes: 0,
      totalBytes: 0,
      unavailableAssetCount: 0,
    };
    // Stat emitted files without materializing native asset sources as Buffers.
    if (!outputFileSystem?.stat) {
      sizes.unavailableAssetCount = assets.length;
    } else {
      await Promise.all(
        assets.map(
          ({ name }) =>
            new Promise<void>((resolve) => {
              outputFileSystem.stat!(join(outputPath, name), (error, stat) => {
                if (error || !stat) sizes.unavailableAssetCount++;
                else {
                  sizes.totalBytes += stat.size;
                  if (name.endsWith('.map')) sizes.sourceMapBytes += stat.size;
                  else if (/\.[cm]?js$/.test(name)) sizes.jsBytes += stat.size;
                  else sizes.otherBytes += stat.size;
                }
                resolve();
              });
            }),
        ),
      );
    }
    record('project:assets', { project, outputPath, ...sizes });
  } catch (error) {
    logger.warn(`Could not record RSS trace assets: ${String(error)}`);
  }
}
