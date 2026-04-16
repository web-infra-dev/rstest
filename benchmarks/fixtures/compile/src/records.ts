import { scenarioSeeds } from './seeds';
import type { ScenarioRecord } from './types';

const seedByName = new Map(scenarioSeeds.map((seed) => [seed.name, seed]));

function countReachableModules(
  entryName: string,
  visited: Set<string> = new Set(),
): number {
  const seed = seedByName.get(entryName);

  if (!seed) {
    return 0;
  }

  for (const dependency of seed.imports) {
    if (visited.has(dependency)) {
      continue;
    }

    visited.add(dependency);
    countReachableModules(dependency, visited);
  }

  return visited.size;
}

function classifyDependencyCount(
  dependencyCount: number,
): ScenarioRecord['bucket'] {
  if (dependencyCount === 0) {
    return 'leaf';
  }

  if (dependencyCount === 1) {
    return 'branch';
  }

  return 'entry';
}

export function createScenarioRecords(): ScenarioRecord[] {
  return scenarioSeeds.map((seed) => {
    const dependencyCount = seed.imports.length;

    return {
      name: seed.name,
      dependencyCount,
      reachableModuleCount: countReachableModules(seed.name),
      bucket: classifyDependencyCount(dependencyCount),
    };
  });
}
