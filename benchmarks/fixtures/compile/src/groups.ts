import { createScenarioRecords } from './records';
import type { ScenarioGroup } from './types';

export function groupScenarioRecords(): ScenarioGroup[] {
  const groups = new Map<ScenarioGroup['bucket'], ScenarioGroup>();

  for (const record of createScenarioRecords()) {
    const existing = groups.get(record.bucket) ?? {
      bucket: record.bucket,
      names: [],
      totalDependencies: 0,
      totalReachableModules: 0,
    };

    existing.names.push(record.name);
    existing.totalDependencies += record.dependencyCount;
    existing.totalReachableModules += record.reachableModuleCount;
    groups.set(record.bucket, existing);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    names: group.names.sort(),
  }));
}
