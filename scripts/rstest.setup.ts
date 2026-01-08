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

// Custom serializer that handles both regular paths and pnpm store normalization
const enhancedPathSerializer = {
  test: (value: any): boolean => {
    return (
      typeof value === 'string' && (value.includes('/') || value.includes('\\'))
    );
  },
  serialize: (value: string): string => {
    // First apply the default path serializer
    const serialized = pathSerializer.serialize(value);

    // Remove quotes for processing
    let normalized = serialized;
    if (normalized.startsWith('"') && normalized.endsWith('"')) {
      normalized = normalized.slice(1, -1);
    }

    // Apply pnpm store normalization on paths that contain pnpm store patterns
    // This handles both the already processed paths (with <HOME>) and raw paths
    normalized = normalized.replace(
      /(?:<HOME>\/[^/]*\/|\/[^/]*\/Users\/[^/]+\/[^/]*\/|\/c\/Users\/[^/]+\/[^/]*\/)pnpm\/store\/v[0-9]+\/links\/([^/]+\/[^/]+)\/[^/]+\/[^/]+\/node_modules\//g,
      '<PNPM_STORE>/$1/node_modules/',
    );

    return JSON.stringify(normalized);
  },
};

expect.addSnapshotSerializer(enhancedPathSerializer);
