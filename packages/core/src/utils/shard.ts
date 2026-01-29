import type { ProjectEntries, RstestContext } from '../types';
import { color, logger } from './logger';
import { getTestEntries } from './testFiles';

/**
 * Distributes test files into a specific shard.
 */
export function getShardedFiles<T extends { testPath: string }>(
  files: T[],
  shard: { count: number; index: number },
): T[] {
  const { count, index } = shard;
  if (count <= 1) {
    return files;
  }
  const size = Math.ceil(files.length / count);
  const start = (index - 1) * size;
  const end = start + size;

  // Sort files to ensure consistent sharding across runs
  return files
    .sort((a, b) => a.testPath.localeCompare(b.testPath))
    .slice(start, end);
}

/**
 * Collects all test entries, shards them, and returns a Map of sharded entries per project.
 * Returns `undefined` if sharding is not configured.
 */
export async function resolveShardedEntries(
  context: RstestContext,
): Promise<Map<string, ProjectEntries> | undefined> {
  const {
    normalizedConfig,
    projects: allProjects,
    rootPath,
    fileFilters,
  } = context;
  const { shard } = normalizedConfig;

  if (!shard) {
    return undefined;
  }

  const allTestEntriesBeforeSharding = (
    await Promise.all(
      allProjects.map(async (p) => {
        const { include, exclude, includeSource, root } = p.normalizedConfig;
        const entries = await getTestEntries({
          include,
          exclude: exclude.patterns,
          includeSource,
          rootPath,
          projectRoot: root,
          fileFilters: fileFilters || [],
        });
        return Object.entries(entries).map(([alias, testPath]) => ({
          project: p.environmentName,
          alias,
          testPath,
        }));
      }),
    )
  ).flat();

  const shardedEntries = getShardedFiles(allTestEntriesBeforeSharding, shard);

  const totalTestFileCount = allTestEntriesBeforeSharding.length;
  const testFilesInShardCount = shardedEntries.length;

  logger.log(
    color.green(
      `Running shard ${shard.index} of ${shard.count} (${testFilesInShardCount} of ${totalTestFileCount} tests)\n`,
    ),
  );

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
      fileFilters: fileFilters,
    });
  }

  return entriesCache;
}
