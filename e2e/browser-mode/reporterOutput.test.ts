import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runBrowserCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureDir = join(__dirname, 'fixtures', 'browser-only-reporters');
const jsonPath = join(fixtureDir, '.tmp', 'report.json');
const xmlPath = join(fixtureDir, '.tmp', 'report.xml');

// RFC Phase 3 verification item 2: a browser-only non-watch run now routes
// through core's `finalizeRunCycle`, which flushes output streams after every
// reporter — so file-writing reporters produce complete output (verified: zero
// `flushOutputStreams` references existed in `packages/browser/src`).
describe('browser mode - browser-only reporter output', () => {
  it('writes complete junit and json reporter files', async ({
    onTestFinished,
  }) => {
    fs.rmSync(join(fixtureDir, '.tmp'), { recursive: true, force: true });
    onTestFinished(() => {
      fs.rmSync(join(fixtureDir, '.tmp'), { recursive: true, force: true });
    });

    const { expectExecSuccess } = await runBrowserCliWithCwd(fixtureDir);
    await expectExecSuccess();

    const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(report.tool).toBe('rstest');
    expect(report.status).toBe('pass');
    expect(report.summary.tests).toBe(2);
    expect(report.summary.passedTests).toBe(2);

    const xml = fs.readFileSync(xmlPath, 'utf8');
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    // A truncated file (unflushed stream) would miss the closing tag.
    expect(xml.trimEnd().endsWith('</testsuites>')).toBe(true);
  });
});
