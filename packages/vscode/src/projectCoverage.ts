import path from 'node:path';

// Normalize a project root to a stable key for coverage comparison. Core may
// report roots with a trailing separator (e.g. `packages/core/`) while the
// extension derives its own from a config file path without one.
export const normalizeRoot = (root: string): string =>
  path.normalize(root).replace(/[\\/]+$/, '');

// Config files whose root is aggregated by *another* config via `projects`.
// `childProjectRoots` are expected pre-normalized (see `normalizeRoot`).
// Coverage from a config's own `projects` is ignored, since an aggregator's
// inline children may share its own root (which would otherwise hide it).
export function computeCoveredConfigs(
  projects: {
    configFilePath: string;
    root: string;
    childProjectRoots: string[];
  }[],
): Set<string> {
  const covered = new Set<string>();
  for (const project of projects) {
    const ownRoot = normalizeRoot(project.root);
    const isCovered = projects.some(
      (other) =>
        other.configFilePath !== project.configFilePath &&
        other.childProjectRoots.includes(ownRoot),
    );
    if (isCovered) {
      covered.add(project.configFilePath);
    }
  }
  return covered;
}
