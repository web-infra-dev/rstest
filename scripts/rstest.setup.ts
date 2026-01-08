import path from 'node:path';
import { expect } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

// Create a custom serializer that handles global pnpm store paths
const pathSerializer = createSnapshotSerializer({
  root: path.resolve(__dirname, '..'),
  features: {
    replaceWorkspace: false,
    escapeDoubleQuotes: false,
    // Ensure consistent path handling across platforms
    replaceHomeDir: true,
    replacePnpmInner: true,
    replaceTmpDir: true,
    transformWin32Path: true,
  },
});

// Custom serializer that allows the built-in path-serializer to work
// but adds additional normalization for global pnpm store paths
const enhancedPathSerializer = {
  test: (value: any): boolean => {
    return (
      typeof value === 'string' && (value.includes('/') || value.includes('\\'))
    );
  },
  serialize: (value: string): string => {
    // First apply the default path serializer which handles:
    // - Windows vs Unix path normalization
    // - <HOME> replacement
    // - <ROOT> replacement
    // - <PNPM_INNER> replacement for local .pnpm paths
    const serialized = pathSerializer.serialize(value);

    // Remove quotes for processing
    let normalized = serialized;
    if (normalized.startsWith('"') && normalized.endsWith('"')) {
      normalized = normalized.slice(1, -1);
    }

    // Additional normalization for global pnpm store paths that aren't handled
    // by the built-in replacePnpmInner (which only handles local .pnpm directories).
    // This handles macOS/Linux global pnpm store paths like:
    // <HOME>/Library/pnpm/store/v10/links/@rsbuild/core/1.7.1/hash/node_modules/@rsbuild/core/...
    // Windows global paths: <HOME>/AppData/Local/pnpm/store/v10/links/...
    // But preserves <PNPM_INNER> replacements for local node_modules/.pnpm paths
    normalized = normalized.replace(
      /<HOME>\/[^/]*\/pnpm\/store\/v[0-9]+\/links\/([^/]+\/[^/]+)\/[^/]+\/[^/]+\/node_modules\//g,
      '<PNPM_STORE>/$1/node_modules/',
    );

    return JSON.stringify(normalized);
  },
};

expect.addSnapshotSerializer(enhancedPathSerializer);
