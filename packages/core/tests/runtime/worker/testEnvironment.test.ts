import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from '@rstest/core';
import { loadTestEnvironment } from '../../../src/runtime/worker/testEnvironment';

describe('loadTestEnvironment', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
      tempDir = undefined;
    }
  });

  it('should continue resolving relative environment files across roots', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rstest-environment-'));

    const firstRoot = join(tempDir, 'project-root');
    const secondRoot = join(tempDir, 'workspace-root');
    const environmentDir = join(secondRoot, 'fixtures');
    const environmentPath = join(environmentDir, 'custom-environment.mjs');

    mkdirSync(firstRoot, { recursive: true });
    mkdirSync(environmentDir, { recursive: true });
    writeFileSync(
      environmentPath,
      [
        'export default {',
        "  name: 'fallback-environment',",
        '  async setup() {',
        '    return {',
        '      async teardown() {},',
        '    };',
        '  },',
        '};',
      ].join('\n'),
      'utf8',
    );

    const environment = await loadTestEnvironment(
      './fixtures/custom-environment.mjs',
      [firstRoot, secondRoot],
    );

    expect(environment.name).toBe('fallback-environment');
  });
});
