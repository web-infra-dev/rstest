import { createHash } from 'node:crypto';
import { relative } from 'pathe';
import type { InternalContext, ProjectEntries, ShardConfig } from '../types';
import { color, logger } from './logger';
import { getTestEntries } from './testFiles';

/**
 * Distributes test files into a specific shard.
 */
export function getShardedFiles<T extends { testPath: string }>(
  files: T[],
  shard: ShardConfig,
  rootPath: string,
): T[] {
  const { count, index } = shard;
  if (count <= 1) {
    return files;
  }
  const size = Math.floor(files.length / count);
  const remainder = files.length % count;
  const start = (index - 1) * size + Math.min(index - 1, remainder);
  const end = start + size + (index <= remainder ? 1 : 0);

  return files
    .map((file) => ({
      file,
      hash: createHash('sha1')
        .update(relative(rootPath, file.testPath))
        .digest('hex'),
    }))
    .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
    .slice(start, end)
    .map(({ file }) => file);
}

export type ShardCounts = {
  testFilesInShardCount: number;
  totalTestFileCount: number;
};

export function logShardMessage({
  shard,
  testFilesInShardCount,
  totalTestFileCount,
}: { shard: ShardConfig } & ShardCounts): void {
  logger.log(
    color.green(
      `Running shard ${shard.index} of ${shard.count} (${testFilesInShardCount} of ${totalTestFileCount} test files)\n`,
    ),
  );
}

/**
 * Collects all test entries, shards them, and returns a Map of sharded entries per project.
 * Returns `undefined` if sharding is not configured.
 *
 * Never logs the shard banner itself — the planner announces the final counts
 * once after its init barrier; this only reports them via `onShardCounts`.
 */
export async function resolveShardedEntries(
  context: InternalContext,
  {
    onShardCounts,
    getFileFilters = () => context.fileFilters,
  }: {
    onShardCounts?: (counts: ShardCounts) => void;
    getFileFilters?: (
      project: InternalContext['projects'][number],
    ) => string[] | undefined;
  } = {},
): Promise<Map<string, ProjectEntries> | undefined> {
  const { normalizedConfig, projects: allProjects, rootPath } = context;
  const { shard } = normalizedConfig;

  if (!shard) {
    return undefined;
  }

  const allTestEntriesBeforeSharding = (
    await Promise.all(
      allProjects.map(async (p) => {
        const { include, exclude, includeSource, root } = p.normalizedConfig;
        const fileFilters = getFileFilters(p);
        const entries = await getTestEntries({
          include,
          exclude: exclude.patterns,
          includeSource,
          rootPath,
          projectRoot: root,
          fileFilters,
        });
        return Object.entries(entries).map(([alias, testPath]) => ({
          project: p.environmentName,
          alias,
          testPath,
        }));
      }),
    )
  ).flat();

  const shardedEntries = getShardedFiles(
    allTestEntriesBeforeSharding,
    shard,
    rootPath,
  );

  const totalTestFileCount = allTestEntriesBeforeSharding.length;
  const testFilesInShardCount = shardedEntries.length;

  onShardCounts?.({ testFilesInShardCount, totalTestFileCount });

  const shardedEntriesByProject = new Map<string, Record<string, string>>();
  for (const { project, alias, testPath } of shardedEntries) {
    if (!shardedEntriesByProject.has(project)) {
      shardedEntriesByProject.set(project, {});
    }
    shardedEntriesByProject.get(project)![alias] = testPath;
  }

  const entriesCache = new Map<string, ProjectEntries>();
  for (const p of allProjects) {
    entriesCache.set(p.environmentName, {
      entries: shardedEntriesByProject.get(p.environmentName) || {},
      fileFilters: getFileFilters(p),
    });
  }

  return entriesCache;
}
