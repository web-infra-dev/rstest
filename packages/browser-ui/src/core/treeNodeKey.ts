/**
 * Single owner of the Ant Design Tree node-key grammar for the browser-mode
 * test tree.
 *
 * Two sites build these keys and MUST agree byte-for-byte: the producer
 * (`TestFilesTree`) builds keys while recursing the tree, and the enumerator
 * (`main.tsx` `allExpandableKeys`) rebuilds the same keys in one pass to drive
 * "expand all". Ant Design requires `expandedKeys ⊆ treeData keys`, so any
 * divergence makes expand-all silently skip a subtree with no error.
 *
 * Every helper builds keys ONLY from structured array inputs — never from a
 * pre-joined string that is later split apart — so a suite or case name that
 * contains a literal `::` can never be mis-parsed.
 */

export const PROJECT_KEY_PREFIX = '__project__';
export const SUITE_KEY_SEGMENT = '::suite::';
export const CASE_KEY_SEGMENT = '::case::';
export const EMPTY_KEY_SUFFIX = '::__empty';

export const projectKey = (projectName: string): string =>
  `${PROJECT_KEY_PREFIX}${projectName}`;

/**
 * Single recursive producer step: append one suite segment whose label is the
 * suite node's full ancestor path. `keyPrefix` is the parent suite's key (or the
 * file key at the top level); `fullPath` is the suite's ancestor names, kept as
 * an array so a literal `::` inside a name is preserved verbatim.
 */
export const appendSuiteSegment = (
  keyPrefix: string,
  fullPath: string[],
): string => `${keyPrefix}${SUITE_KEY_SEGMENT}${fullPath.join('::')}`;

/**
 * Full one-pass accumulation of a suite key from the file key and the suite's
 * ancestor names. Equals folding {@link appendSuiteSegment} over every ancestor
 * prefix, so it reproduces the recursive producer output exactly — this is the
 * form the enumerator uses.
 */
export const suiteKey = (fileKey: string, parentNames: string[]): string => {
  let key = fileKey;
  for (let i = 1; i <= parentNames.length; i++) {
    key = appendSuiteSegment(key, parentNames.slice(0, i));
  }
  return key;
};

export const caseKey = (parentKey: string, caseId: string): string =>
  `${parentKey}${CASE_KEY_SEGMENT}${caseId}`;

export const emptyKey = (fileKey: string): string =>
  `${fileKey}${EMPTY_KEY_SUFFIX}`;
