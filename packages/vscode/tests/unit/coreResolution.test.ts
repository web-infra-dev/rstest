import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  formatConfiguredCoreNotFoundMessage,
  formatCoreNotFoundMessage,
  isModuleNotFoundError,
} from '../../src/coreResolution';

// Resolve for real rather than hand-building an error object: the predicate
// reads a message Node owns, so a fake error would only assert itself.
const resolveError = (specifier: string, from: string): unknown => {
  try {
    require.resolve(specifier, { paths: [from] });
  } catch (e) {
    return e;
  }
  throw new Error(`expected "${specifier}" not to resolve`);
};

describe('isModuleNotFoundError', () => {
  it('should detect a package that is not installed', () => {
    const specifier = '@rstest/definitely-not-installed';
    expect(
      isModuleNotFoundError(resolveError(specifier, __dirname), specifier),
    ).toBe(true);
  });

  it('should reject a package whose entry file is missing', () => {
    // An interrupted install, or a workspace link that has not been built:
    // installed, but unusable. Node reports the missing file, not the package.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-vscode-'));
    const pkgDir = path.join(root, 'node_modules', 'broken-package');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      '{"name":"broken-package","version":"1.0.0","main":"./gone.js"}',
    );

    expect(
      isModuleNotFoundError(
        resolveError('broken-package', root),
        'broken-package',
      ),
    ).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should ignore other errors', () => {
    expect(isModuleNotFoundError(new Error('boom'), 'boom')).toBe(false);
    expect(isModuleNotFoundError('MODULE_NOT_FOUND', 'x')).toBe(false);
    expect(isModuleNotFoundError(undefined, 'x')).toBe(false);
  });
});

describe('core-not-found messages', () => {
  it('should point at the configured package path instead of the install hint', () => {
    const message = formatConfiguredCoreNotFoundMessage(
      '/repo/vendor/core/package.json',
    );
    expect(message).toContain('/repo/vendor/core/package.json');
    expect(message).not.toContain('Install the project dependencies');
    expect(formatCoreNotFoundMessage('/repo/app')).toContain(
      'Install the project dependencies',
    );
  });
});
