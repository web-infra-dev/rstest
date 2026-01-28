import path from 'node:path';
import type { TaskDefinition } from './types';

export type ScriptEntry = {
  scriptId: string;
  url?: string;
};

type ScoredScriptEntry = ScriptEntry & {
  order: number;
  score: number;
};

const normalizePath = (value: string) => value.replace(/\\/g, '/');

export class ScriptPriorityQueue {
  private readonly cwd: string;
  private readonly taskSourcePaths: string[];
  private order = 0;
  private readonly queue: ScoredScriptEntry[] = [];

  constructor({ cwd, tasks }: { cwd: string; tasks: TaskDefinition[] }) {
    this.cwd = normalizePath(cwd);
    this.taskSourcePaths = tasks.map((t) => normalizePath(t.sourcePath));
  }

  enqueue(entry: ScriptEntry): void {
    this.queue.push({
      ...entry,
      order: this.order++,
      score: this.score(entry.url),
    });
  }

  takeNext(): ScriptEntry | null {
    if (!this.queue.length) return null;
    let bestIndex = 0;
    for (let i = 1; i < this.queue.length; i += 1) {
      const a = this.queue[i]!;
      const b = this.queue[bestIndex]!;
      if (a.score > b.score || (a.score === b.score && a.order < b.order)) {
        bestIndex = i;
      }
    }
    const picked = this.queue.splice(bestIndex, 1)[0];
    return picked ? { scriptId: picked.scriptId, url: picked.url } : null;
  }

  private score(url?: string): number {
    if (!url) return 0;
    let score = 0;

    if (url.startsWith('file://')) score += 20;
    if (url.includes('/dist/.rstest-temp/')) score += 40;
    if (this.cwd && url.includes(this.cwd)) score += 20;

    if (url.includes('/node_modules/')) {
      const tasksInNodeModules = this.taskSourcePaths.some((p) =>
        p.includes('/node_modules/'),
      );
      if (tasksInNodeModules) score += 5;
    }

    const base = path.posix.basename(url);
    if (base) {
      const taskBases = this.taskSourcePaths.map((p) => path.posix.basename(p));
      if (taskBases.includes(base)) score += 10;
    }

    if (url.endsWith('.mjs') || url.endsWith('.js')) score += 2;

    return score;
  }
}
