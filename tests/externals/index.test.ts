import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test externals', () => {
  it('should external node_modules by default', async () => {
    process.env.DEBUG_RSTEST_OUTPUTS = 'true';
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/index.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const outputPath = join(__dirname, 'dist/fixtures/index.test.ts.js');

    expect(fs.existsSync(outputPath)).toBeTruthy();
    const content = fs.readFileSync(outputPath, 'utf-8');

    expect(content).toContain('require("picocolors")');
    expect(content).toContain('import("strip-ansi")');
  });
});
