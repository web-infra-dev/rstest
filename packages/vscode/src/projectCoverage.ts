import path from 'node:path';

// Normalize a project root to a stable key for coverage comparison. Core may
// report roots with a trailing separator (e.g. `packages/core/`) while the
// extension derives its own from a config file path without one.
const normalizeRoot = (root: string): string =>
  path.normalize(root).replace(/[\\/]+$/, '');

const isSubset = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size > b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
};

// Whether `ancestor` is a strict parent directory of `descendant`. Both are
// expected pre-normalized (see `normalizeRoot`).
const isStrictAncestor = (ancestor: string, descendant: string): boolean => {
  const rel = path.relative(ancestor, descendant);
  // `rel === ''` covers the equal-path case (not a strict ancestor).
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// Whether `parent` aggregates a nested intermediate config `child`. `initCli`
// flattens such a child to its grandchildren, so the child's own root never
// appears in `parent`'s root list — but its grandchildren roots do. So the
// child is covered when its own aggregated roots are a subset of the parent's.
// When the two sets are equal (a parent that aggregates *only* this one nested
// child), the outer config — the one whose root is an ancestor — wins, so two
// unrelated configs with identical roots never suppress each other (hiding
// both).
const aggregatesNestedConfig = (
  child: { root: string; children: Set<string> },
  parent: { root: string; children: Set<string> },
): boolean => {
  if (child.children.size === 0 || !isSubset(child.children, parent.children)) {
    return false;
  }
  return (
    parent.children.size > child.children.size ||
    isStrictAncestor(parent.root, child.root)
  );
};

// Config files whose tests are already rendered by *another* config, so the
// extension should not register them as their own top-level project (otherwise
// the same files show up twice). Roots (own and child) are normalized here, so
// callers may pass them raw. A config is covered when another config either:
//   - aggregates this config's own root via `projects` (a leaf child). This is
//     only applied when the root uniquely identifies a single discovered
//     config: when several configs share a directory (e.g. `rstest.config.ts`
//     plus `rstest.e2e.config.ts`, with different `include`/`exclude`), a
//     parent that aggregates only one of them must not hide the others, whose
//     tests it does not render.
//   - aggregates this config's own child roots (a nested intermediate config;
//     see `aggregatesNestedConfig`). This is inferred from the flattened
//     grandchildren, so it carries a tiebreak for the ambiguous equal-set case.
// In both cases the parent must also be able to *display* the child's files:
// in AST mode a project only globs its own `include`, so a child whose include
// patterns the parent does not also match is kept visible (its tests would
// otherwise vanish from the tree even though the aggregated run still executes
// them). Coverage from a config's own `projects` is ignored, since an
// aggregator's inline children may share its own root (which would hide it).
export function computeCoveredConfigs(
  projects: {
    configFilePath: string;
    root: string;
    childProjectRoots: string[];
    include: string[];
  }[],
): Set<string> {
  const nodes = projects.map((project) => ({
    configFilePath: project.configFilePath,
    root: normalizeRoot(project.root),
    children: new Set(project.childProjectRoots.map(normalizeRoot)),
    include: new Set(project.include),
  }));
  const configsPerRoot = new Map<string, number>();
  for (const node of nodes) {
    configsPerRoot.set(node.root, (configsPerRoot.get(node.root) ?? 0) + 1);
  }
  const covered = new Set<string>();
  for (const project of nodes) {
    const rootIsUnique = configsPerRoot.get(project.root) === 1;
    const isCovered = nodes.some(
      (other) =>
        other.configFilePath !== project.configFilePath &&
        isSubset(project.include, other.include) &&
        ((rootIsUnique && other.children.has(project.root)) ||
          aggregatesNestedConfig(project, other)),
    );
    if (isCovered) {
      covered.add(project.configFilePath);
    }
  }
  return covered;
}
