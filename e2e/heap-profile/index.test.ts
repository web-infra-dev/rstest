import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('--heapProfile', () => {
  it('appends one NDJSON record per test file', async ({ onTestFinished }) => {
    const profilePath = join(
      tmpdir(),
      `rstest-heap-profile-${process.pid}-${Date.now()}.jsonl`,
    );
    onTestFinished(() => {
      if (existsSync(profilePath)) unlinkSync(profilePath);
    });

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', `--heapProfile=${profilePath}`],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, './fixtures'),
        },
      },
    });
    await expectExecSuccess();

    expect(existsSync(profilePath)).toBe(true);

    // The fixture has 3 test files and 1 worker. The profile should
    // therefore contain at least 3 records — one per file. (Strict
    // equality would be brittle if a future rstest change emitted
    // an extra record during shutdown; `>=` is the invariant we care
    // about.)
    const lines = readFileSync(profilePath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);

    // Every record is valid JSON with the documented schema.
    for (const line of lines) {
      const record = JSON.parse(line);
      expect(typeof record.pid).toBe('number');
      expect(typeof record.seq).toBe('number');
      expect(typeof record.test).toBe('string');
      expect(typeof record.heapUsed).toBe('number');
      expect(typeof record.heapTotal).toBe('number');
      expect(typeof record.rss).toBe('number');
      expect(typeof record.external).toBe('number');
      expect(typeof record.ts).toBe('number');
    }
  });
});
