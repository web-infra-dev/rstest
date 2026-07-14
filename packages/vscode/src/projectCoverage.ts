import path from 'node:path';

export type ChildProjectRef = {
  // The child's own config file, or null for an inline project.
  configFilePath: string | null;
  root: string | null;
};

// Normalize a reported path (a root directory or a config file) to a stable
// comparison key. Core may report roots with a trailing separator (e.g.
// `packages/core/`) while the extension derives its own from a config file
// path without one; on Windows paths are case-insensitive and VS Code
// lowercases drive letters in `Uri.fsPath` while core reports paths as the
// process resolved them.
const normalizePath = (value: string): string => {
  const normalized = path.normalize(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

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
// expected pre-normalized (see `normalizePath`).
const isStrictAncestor = (ancestor: string, descendant: string): boolean => {
  const rel = path.relative(ancestor, descendant);
  // `rel === ''` covers the equal-path case (not a strict ancestor).
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

type Node = {
  key: string;
  configFilePath: string;
  root: string;
  footprint: Set<string>;
  include: Set<string>;
};

// Whether `parent` aggregates a nested intermediate config `child`. `initCli`
// flattens such a child to its leaf projects, so the child's own config file
// never appears in `parent`'s footprint — but its leaves do. So the child is
// covered when its own footprint is a subset of the parent's. When the two
// footprints are equal (a parent that aggregates *only* this one nested
// child), the outer config — the one whose root is an ancestor — wins, so two
// unrelated configs with identical footprints never suppress each other
// (hiding both).
const aggregatesNestedConfig = (child: Node, parent: Node): boolean => {
  if (
    child.footprint.size === 0 ||
    !isSubset(child.footprint, parent.footprint)
  ) {
    return false;
  }
  return (
    parent.footprint.size > child.footprint.size ||
    isStrictAncestor(parent.root, child.root)
  );
};

// Config files whose tests are already rendered by *another* config, so the
// extension should not register them as their own top-level project (otherwise
// the same files show up twice). Each project's `footprint` is the set of leaf
// projects it runs, keyed by config file when the leaf has one and by root for
// inline projects. A config is covered when another config either:
//   - has this config's own file in its footprint (it directly aggregates this
//     config as a leaf — exact identity, so a directory holding several
//     configs is disambiguated for free);
//   - aggregates this config's own leaves (a nested intermediate config, whose
//     own file `initCli` flattens away; see `aggregatesNestedConfig`).
// In both cases the parent must also be able to *display* the child's files:
// in AST mode a project only globs its own `include`, so a child whose include
// patterns the parent does not also match is kept visible (its tests would
// otherwise vanish from the tree even though the aggregated run still executes
// them). Returns the `key`s of the covered configs; `configFilePath` is only
// match material.
export function computeCoveredConfigs(
  projects: {
    key: string;
    configFilePath: string;
    root: string;
    childProjects: ChildProjectRef[];
    include: string[];
  }[],
): Set<string> {
  const nodes = projects.map((project): Node => {
    const footprint = new Set<string>();
    for (const child of project.childProjects) {
      if (child.configFilePath) {
        footprint.add(normalizePath(child.configFilePath));
      } else if (child.root) {
        footprint.add(normalizePath(child.root));
      }
    }
    return {
      key: project.key,
      configFilePath: normalizePath(project.configFilePath),
      root: normalizePath(project.root),
      footprint,
      include: new Set(project.include),
    };
  });
  const covered = new Set<string>();
  for (const project of nodes) {
    const isCovered = nodes.some(
      (other) =>
        other !== project &&
        isSubset(project.include, other.include) &&
        (other.footprint.has(project.configFilePath) ||
          aggregatesNestedConfig(project, other)),
    );
    if (isCovered) {
      covered.add(project.key);
    }
  }
  return covered;
}
