import fs from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readJson(filePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, any>;
}

describe('cli init browser', () => {
  const projectDir = path.join(__dirname, 'fixtures', 'test-temp-init-browser');

  beforeEach(() => {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      `${JSON.stringify({ name: 'fixture', private: true }, null, 2)}\n`,
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('should generate files and update package.json in --yes mode', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['init', 'browser', '--yes'],
      options: {
        nodeOptions: {
          cwd: projectDir,
        },
      },
    });

    await expectExecSuccess();

    expect(
      fs.existsSync(path.join(projectDir, 'rstest.browser.config.ts')),
    ).toBe(true);

    expect(
      fs.existsSync(path.join(projectDir, 'tests', 'Counter.test.ts')) ||
        fs.existsSync(path.join(projectDir, 'tests', 'Counter.test.js')),
    ).toBe(true);

    const pkg = readJson(path.join(projectDir, 'package.json'));
    expect(pkg.scripts?.['test:browser']).toBe(
      'rstest --config=rstest.browser.config.ts',
    );
  });
});
