/**
 * Pure watch-invalidation policy shared by the node dev-compile pipeline
 * (`calcEntriesToRerun` in rsbuild.ts) and the browser watch plugin
 * (hostController). Callers translate their compiler stats into per-entry
 * chunk-hash snapshots; this module owns the diff and the
 * setup-change => rerun-all rule.
 *
 * Baselines are keyed per project/environment by the caller — one mutable
 * state handle per key, never one per executor — so sibling projects with
 * separate compilers cannot clobber each other's baselines or collide on
 * compiler-local chunk keys.
 */

/** Chunk hashes for one entry: stable chunk key -> chunk hash. */
export type EntryChunkHashes = Record<string, string>;

/** Entry id (test/setup path) -> that entry's chunk hashes, for one compile. */
export type EntryHashSnapshot = Map<string, EntryChunkHashes>;

/** Mutable per-project/environment baseline handle owned by the caller. */
export type WatchInvalidationState = {
  entryHashes?: EntryHashSnapshot;
  setupHashes?: EntryHashSnapshot;
};

export type WatchInvalidationOutcome = {
  /** A setup entry changed or disappeared: every entry must rerun. */
  rerunAll: boolean;
  /** Entries whose chunk hashes changed or newly appeared since the baseline. */
  affectedPaths: string[];
  /** Entries present in the baseline but missing from this compile. */
  deletedPaths: string[];
};

const diffEntryHashes = (
  previous: EntryHashSnapshot | undefined,
  current: EntryHashSnapshot,
): { affectedPaths: Set<string>; deletedPaths: string[] } => {
  const affectedPaths = new Set<string>();
  const deletedPaths: string[] = [];

  // No baseline yet (first compile): establish it without marking anything.
  if (!previous) {
    return { affectedPaths, deletedPaths };
  }

  for (const name of previous.keys()) {
    if (!current.has(name)) {
      deletedPaths.push(name);
    }
  }

  current.forEach((currentChunks, entryPath) => {
    const prevChunks = previous.get(entryPath);

    if (!prevChunks) {
      affectedPaths.add(entryPath);
      return;
    }

    const currentChunkNames = Object.keys(currentChunks);
    if (currentChunkNames.length !== Object.keys(prevChunks).length) {
      affectedPaths.add(entryPath);
      return;
    }

    const hasChanges = currentChunkNames.some(
      (chunkName) => prevChunks[chunkName] !== currentChunks[chunkName],
    );

    if (hasChanges) {
      affectedPaths.add(entryPath);
    }
  });

  return { affectedPaths, deletedPaths };
};

/**
 * Diff one compile's snapshots against the baseline in `state`, then advance
 * the baseline to the new snapshots. A changed/deleted setup entry short-
 * circuits to `rerunAll` (its effects on individual tests are invisible to
 * the per-entry hash diff, so everything must rerun).
 */
export const applyWatchInvalidation = (
  state: WatchInvalidationState,
  snapshot: {
    entryHashes: EntryHashSnapshot;
    setupHashes?: EntryHashSnapshot;
  },
): WatchInvalidationOutcome => {
  const previousEntryHashes = state.entryHashes;
  const previousSetupHashes = state.setupHashes;
  const setupHashes = snapshot.setupHashes ?? new Map();

  state.entryHashes = snapshot.entryHashes;
  state.setupHashes = setupHashes;

  const setupDiff = diffEntryHashes(previousSetupHashes, setupHashes);

  if (setupDiff.affectedPaths.size > 0 || setupDiff.deletedPaths.length > 0) {
    return { rerunAll: true, affectedPaths: [], deletedPaths: [] };
  }

  const { affectedPaths, deletedPaths } = diffEntryHashes(
    previousEntryHashes,
    snapshot.entryHashes,
  );

  return {
    rerunAll: false,
    affectedPaths: Array.from(affectedPaths),
    deletedPaths,
  };
};
