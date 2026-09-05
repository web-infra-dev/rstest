import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import { prepareFixtures } from '../scripts';
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
  it.each(['node', 'browser'])(
    'orders %s report paths by code units and preserves in-file test order',
    async (mode) => {
      const target = join(
        __dirname,
        'fixtures',
        `fixtures-test-report-order-${mode}`,
      );
      const { fs: fixtureFs } = await prepareFixtures({
        fixturesPath: fixtureDir,
        fixturesTargetPath: target,
      });
      onTestFinished(() => fixtureFs.delete(target));
      fixtureFs.delete(join(target, 'tests/browser.test.ts'));
      const paths = ['ä.test.ts', 'z.test.ts', 'a.test.ts', 'B.test.ts'];
      for (const path of paths) {
        fs.copyFileSync(
          join(__dirname, '../reporter/fixtures/agent-md-pass/many.test.ts'),
          join(target, 'tests', path),
        );
      }

      const { expectExecSuccess } = await runBrowserCliWithCwd(target, {
        args: mode === 'node' ? ['--browser.enabled=false'] : [],
        env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      });
      await expectExecSuccess();

      const report = JSON.parse(
        fs.readFileSync(join(target, '.tmp/report.json'), 'utf8'),
      );
      const orderedPaths = [
        'tests/B.test.ts',
        'tests/a.test.ts',
        'tests/z.test.ts',
        'tests/ä.test.ts',
      ];
      expect(
        report.files.map((file: { testPath: string }) => file.testPath),
      ).toEqual(orderedPaths);
      expect(
        report.tests.map((test: { testPath: string; fullName: string }) => [
          test.testPath,
          test.fullName,
        ]),
      ).toEqual(
        orderedPaths.flatMap((path) =>
          Array.from({ length: 12 }, (_, i) => [
            path,
            `agent-md-pass > case ${i + 1}`,
          ]),
        ),
      );
    },
  );

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
