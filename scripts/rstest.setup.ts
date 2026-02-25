import path from 'node:path';
import { expect } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

// Prevent the test runner from being detected as an AI agent during self-testing.
// This ensures consistent behavior regardless of the environment running the tests.
process.env.RSTEST_NO_AGENT = '1';

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

    // Normalize pnpm "virtual store" paths under `<ROOT>/node_modules/.pnpm/...`
    // (rendered by path-serializer as `<ROOT>/node_modules/<PNPM_INNER>/...`) into
    // the `<PNPM_STORE>/<pkg>/node_modules/<pkg>/...` shape used by snapshots.
    serialized = serialized.replace(
      /<ROOT>\/node_modules\/<PNPM_INNER>\/((?:@[^/]+\/)?[^/]+)(?=\/|")/g,
      '<PNPM_STORE>/$1/node_modules/$1',
    );

    // Normalize pnpm global store paths (macOS/Linux and Windows), stripping out
    // version/hash folders to keep snapshots stable across machines.
    //
    // Example:
    // `<HOME>/Library/pnpm/store/v10/links/react-dom/19.2.3/<hash>/node_modules/react-dom/...`
    //   -> `<PNPM_STORE>/react-dom/node_modules/react-dom/...`
    serialized = serialized.replace(
      /<HOME>\/(?:[^/]+\/)*pnpm\/store\/v[0-9]+\/links\/((?:@[^/]+\/)?[^/]+)\/[^/]+(?:\/[^/]+)*\/node_modules\//gi,
      '<PNPM_STORE>/$1/node_modules/',
    );

    return serialized;
  },
};

expect.addSnapshotSerializer(enhancedPathSerializer);
