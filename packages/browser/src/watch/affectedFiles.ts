import { logger } from '@rstest/core/browser';
import { normalize } from 'pathe';
import { watchContext } from './context';
import type { StatsChunk, StatsModule } from './statsTypes';

/**
 * Find test file path from chunk modules by matching against known entry files.
 */
const findTestFileInModules = (
  modules: StatsModule[] | undefined,
  entryTestFiles: Set<string>,
): string | null => {
  if (!modules) return null;

  for (const m of modules) {
    if (m.nameForCondition) {
      const normalizedPath = normalize(m.nameForCondition);
      if (entryTestFiles.has(normalizedPath)) {
        return normalizedPath;
      }
    }
    if (m.children) {
      const found = findTestFileInModules(m.children, entryTestFiles);
      if (found) return found;
    }
  }
  return null;
};

/**
 * Get a stable identifier for a chunk.
 * Prefers chunk.id or chunk.names[0] over file paths for stability.
 */
const getChunkKey = (chunk: StatsChunk): string | null => {
  if (chunk.id != null) {
    return String(chunk.id);
  }
  if (chunk.names && chunk.names.length > 0) {
    return chunk.names[0]!;
  }
  if (chunk.files && chunk.files.length > 0) {
    return chunk.files[0]!;
  }
  return null;
};

/**
 * Compare chunk hashes and find affected test files for watch mode re-runs.
 * Uses chunk.id/names as stable keys instead of relying on file path patterns.
 */
export const getAffectedTestFiles = (
  chunks: StatsChunk[] | undefined,
  entryTestFiles: Set<string>,
): string[] => {
  if (!chunks) return [];

  const affectedFiles = new Set<string>();
  const currentHashes = new Map<string, string>();

  for (const chunk of chunks) {
    if (!chunk.hash) continue;

    // First check if this chunk contains a test entry file
    const testFile = findTestFileInModules(chunk.modules, entryTestFiles);
    if (!testFile) continue;

    // Get a stable key for this chunk
    const chunkKey = getChunkKey(chunk);
    if (!chunkKey) continue;

    const prevHash = watchContext.chunkHashes.get(chunkKey);
    currentHashes.set(chunkKey, chunk.hash);

    if (prevHash !== undefined && prevHash !== chunk.hash) {
      affectedFiles.add(testFile);
      logger.debug(
        `[Watch] Chunk hash changed for ${chunkKey}: ${prevHash} -> ${chunk.hash} (test: ${testFile})`,
      );
    }
  }

  watchContext.chunkHashes = currentHashes;
  return Array.from(affectedFiles);
};
