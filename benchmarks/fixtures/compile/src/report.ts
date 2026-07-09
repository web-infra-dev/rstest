import { groupScenarioRecords } from './groups';

export function buildScenarioPlan(): string[] {
  return groupScenarioRecords()
    .sort((left, right) => right.totalDependencies - left.totalDependencies)
    .map(
      (group) =>
        `${group.bucket}:${group.totalDependencies}:${group.totalReachableModules}:${group.names.join('|')}`,
    );
}

export function renderScenarioReport(): string {
  return buildScenarioPlan().join('\n');
}
