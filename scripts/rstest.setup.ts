import path from 'node:path';
import { expect } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

// The default path-serializer doesn't normalize pnpm global store paths (e.g.
// `<HOME>/Library/pnpm/store/.../node_modules/pkg/...`) which makes snapshots
// OS/host dependent. Keep existing snapshot patterns by mapping those store
// paths to the same `<ROOT>/node_modules/<PNPM_INNER>/...` shape.
const pathSerializer = createSnapshotSerializer({
  root: path.resolve(__dirname, '..'),
  features: {
    replaceWorkspace: false,
    escapeDoubleQuotes: false,
    replaceHomeDir: true,
    replacePnpmInner: true,
    replaceTmpDir: true,
    transformWin32Path: true,
  },
});

const enhancedPathSerializer = {
  test: (value: any): boolean => {
    return (
      typeof value === 'string' && (value.includes('/') || value.includes('\\'))
    );
  },
  serialize: (value: string): string => {
    // `pathSerializer.serialize` returns a snapshot-ready string (including quotes).
    let serialized = pathSerializer.serialize(value);

    // Normalize pnpm global store paths (macOS/Linux and Windows) into the same
    // placeholder used by existing snapshots.
    //
    // Example:
    // `<HOME>/Library/pnpm/store/v10/links/@rsbuild/core/.../node_modules/@rsbuild/core/dist/...`
    //   -> `<ROOT>/node_modules/<PNPM_INNER>/@rsbuild/core/dist/...`
    serialized = serialized.replace(
      /<HOME>\/(?:[^/]+\/)*pnpm\/store\/v[0-9]+\/links\/((?:@[^/]+\/)?[^/]+)\/[^/]+(?:\/[^/]+)*\/node_modules\/\1(?=\/|")/gi,
      '<ROOT>/node_modules/<PNPM_INNER>/$1',
    );

    return serialized;
  },
};

expect.addSnapshotSerializer(enhancedPathSerializer);
