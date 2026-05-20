import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { loadTestEnvironment } from '../../src/runtime/worker/testEnvironment';

describe('loadTestEnvironment', () => {
  it('resolves rstest-environment-* fallback packages', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-env-loader-'));
    const packageDir = path.join(
      root,
      'node_modules',
      'rstest-environment-custom',
    );

    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'rstest-environment-custom',
        type: 'module',
        exports: './index.mjs',
      }),
    );
    fs.writeFileSync(
      path.join(packageDir, 'index.mjs'),
      `export default {
        name: 'custom',
        setup() {
          return { teardown() {} };
        },
      };
      `,
    );

    try {
      const environment = await loadTestEnvironment('custom', [root]);

      expect(environment.name).toBe('custom');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});