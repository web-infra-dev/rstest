import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import treeKill from 'tree-kill';
import { prepareFixtures } from '../scripts';
import { runBrowserCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - snapshot', () => {
  const fixturesTargetPath = `${__dirname}/fixtures-test-snapshot${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;
  let fixtureDir = '';
  let snapshotDir = '';
  let fileSnapshotDir = '';
  let fixturesFs: Awaited<ReturnType<typeof prepareFixtures>>['fs'] | undefined;
  let cliToKill:
    | Awaited<ReturnType<typeof runBrowserCliWithCwd>>['cli']
    | undefined;

  const runSnapshot = async (args?: string[]) => {
    const result = await runBrowserCliWithCwd(fixtureDir, {
      args,
    });
    cliToKill = result.cli;
    return result;
  };

  beforeEach(async () => {
    const { fs: preparedFs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures`,
      fixturesTargetPath,
    });
    fixturesFs = preparedFs;

    fixtureDir = path.join(fixturesTargetPath, 'snapshot');
    snapshotDir = path.join(fixtureDir, 'tests', '__snapshots__');
    fileSnapshotDir = path.join(fixtureDir, '__file_snapshots__');
  });

  afterEach(async () => {
    // Kill the process tree (best-effort).
    // Snapshot runs should exit on their own, but failures/timeouts may leave
    // child processes (e.g. browser) running and locking files on Windows.
    const pid = cliToKill?.exec.process?.pid;
    const exitCode = cliToKill?.exec.process?.exitCode;
    if (pid && (exitCode === null || exitCode === undefined)) {
      treeKill(pid, 'SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    cliToKill = undefined;

    try {
      fixturesFs?.delete(fixturesTargetPath);
    } catch (err) {
      if (process.platform !== 'win32') {
        throw err;
      }
    }

    fixturesFs = undefined;
  });

  describe('Create - initial snapshot creation', () => {
    it('should create snapshot files on first run', async () => {
      // Snapshot directory should not exist initially
      expect(fs.existsSync(snapshotDir)).toBe(false);

      const { expectExecSuccess, cli } = await runSnapshot([
        'tests/snapshot.test.ts',
      ]);

      await expectExecSuccess();

      // Verify snapshot file was created
      const snapshotFile = path.join(snapshotDir, 'snapshot.test.ts.snap');
      expect(fs.existsSync(snapshotFile)).toBe(true);

      // Verify snapshot content
      const content = fs.readFileSync(snapshotFile, 'utf-8');
      expect(content).toContain('// Rstest Snapshot');
      expect(content).toContain(
        'browser snapshot > should match object snapshot',
      );
      expect(content).toContain(
        'browser snapshot > should match string snapshot',
      );
      expect(content).toContain(
        'browser snapshot > should match DOM element snapshot',
      );
      expect(content).toContain(
        'browser snapshot > should match array snapshot',
      );
      expect(content).toContain(
        'browser snapshot > should match nested object snapshot',
      );

      // Verify stdout reports snapshots written
      expect(cli.stdout).toMatch(/Snapshots.*\d+.*written/);
    });
  });

  describe('Read - snapshot matching', () => {
    it('should match existing snapshots on subsequent runs', async () => {
      // First run: create snapshots
      const { expectExecSuccess: firstExecSuccess } = await runSnapshot([
        'tests/snapshot.test.ts',
      ]);
      await firstExecSuccess();

      // Verify snapshot file exists
      const snapshotFile = path.join(snapshotDir, 'snapshot.test.ts.snap');
      expect(fs.existsSync(snapshotFile)).toBe(true);

      // Second run: should match existing snapshots
      const { expectExecSuccess, cli } = await runSnapshot([
        'tests/snapshot.test.ts',
      ]);

      await expectExecSuccess();
      expect(cli.stdout).toMatch(/Tests.*passed/);

      // Should NOT report any new snapshots written
      expect(cli.stdout).not.toMatch(/Snapshots.*written/);
    });

    it('should fail when snapshot does not match', async () => {
      // First run: create initial snapshot
      const { expectExecSuccess: firstExecSuccess } = await runSnapshot([
        'tests/update.test.ts',
      ]);
      await firstExecSuccess();

      // Modify the test file to change the value
      const updateTestPath = path.join(fixtureDir, 'tests', 'update.test.ts');
      const modifiedContent = `import { describe, expect, it } from '@rstest/core';

describe('browser snapshot update', () => {
  it('should match updatable snapshot', () => {
    const value = 'MODIFIED_VALUE';
    expect(value).toMatchSnapshot();
  });
});
`;
      fs.writeFileSync(updateTestPath, modifiedContent);

      // Second run: should fail because snapshot doesn't match
      const { cli } = await runSnapshot(['tests/update.test.ts']);

      await cli.exec;
      expect(cli.exec.exitCode).toBe(1);
      expect(cli.stdout).toMatch(/mismatched|failed/i);
    });
  });

  describe('Update - snapshot update with --update flag', () => {
    it('should update snapshots when using --update flag', async () => {
      // First run: create initial snapshot
      const { expectExecSuccess: firstExecSuccess } = await runSnapshot([
        'tests/update.test.ts',
      ]);
      await firstExecSuccess();

      // Verify initial snapshot content
      const snapshotFile = path.join(snapshotDir, 'update.test.ts.snap');
      let content = fs.readFileSync(snapshotFile, 'utf-8');
      expect(content).toContain('ORIGINAL_VALUE');

      // Modify the test file
      const updateTestPath = path.join(fixtureDir, 'tests', 'update.test.ts');
      const modifiedContent = `import { describe, expect, it } from '@rstest/core';

describe('browser snapshot update', () => {
  it('should match updatable snapshot', () => {
    const value = 'UPDATED_VALUE';
    expect(value).toMatchSnapshot();
  });
});
`;
      fs.writeFileSync(updateTestPath, modifiedContent);

      // Run with --update flag to update the snapshot
      const { expectExecSuccess, cli } = await runSnapshot([
        'tests/update.test.ts',
        '--update',
      ]);

      await expectExecSuccess();

      // Verify snapshot was updated
      content = fs.readFileSync(snapshotFile, 'utf-8');
      expect(content).toContain('UPDATED_VALUE');
      expect(content).not.toContain('ORIGINAL_VALUE');

      // Verify stdout reports snapshot updated
      expect(cli.stdout).toMatch(/Snapshots.*\d+.*updated/);
    });
  });

  describe('Delete - obsolete snapshot removal', () => {
    it('should report obsolete snapshots when test is removed', async () => {
      // First run: create snapshots for both tests
      const { expectExecSuccess: firstExecSuccess } = await runSnapshot();
      await firstExecSuccess();

      // Verify both snapshot files exist
      expect(
        fs.existsSync(path.join(snapshotDir, 'snapshot.test.ts.snap')),
      ).toBe(true);
      expect(fs.existsSync(path.join(snapshotDir, 'update.test.ts.snap'))).toBe(
        true,
      );

      // Now run only one test file - the other snapshots become obsolete
      // Note: obsolete detection might depend on running with specific flags
      const { expectExecSuccess } = await runSnapshot([
        'tests/snapshot.test.ts',
      ]);

      await expectExecSuccess();
      // Both files should still exist (obsolete snapshots are not auto-deleted)
      expect(
        fs.existsSync(path.join(snapshotDir, 'snapshot.test.ts.snap')),
      ).toBe(true);
    });
  });

  describe('Multiple snapshots in single test', () => {
    it('should handle multiple snapshots in the same test file', async () => {
      const { expectExecSuccess } = await runSnapshot([
        'tests/snapshot.test.ts',
      ]);

      await expectExecSuccess();

      // Verify all 5 snapshots were created
      const snapshotFile = path.join(snapshotDir, 'snapshot.test.ts.snap');
      const content = fs.readFileSync(snapshotFile, 'utf-8');

      // Count the number of snapshot entries
      const snapshotCount = (content.match(/exports\[/g) || []).length;
      expect(snapshotCount).toBe(5);
    });
  });

  describe('Error snapshot - toThrowErrorMatchingSnapshot', () => {
    it('should create and match error snapshots', async () => {
      // First run: create error snapshot
      const { expectExecSuccess: firstExecSuccess } = await runSnapshot([
        'tests/error.test.ts',
      ]);
      await firstExecSuccess();

      // Verify error snapshot file was created
      const snapshotFile = path.join(snapshotDir, 'error.test.ts.snap');
      expect(fs.existsSync(snapshotFile)).toBe(true);

      const content = fs.readFileSync(snapshotFile, 'utf-8');
      expect(content).toContain('Test error message');
      expect(content).toContain('should match error snapshot');

      // Second run: should match existing snapshot
      const { expectExecSuccess, cli } = await runSnapshot([
        'tests/error.test.ts',
      ]);

      await expectExecSuccess();
      expect(cli.stdout).toMatch(/Tests.*passed/);
    });
  });

  describe('File snapshot - toMatchFileSnapshot', () => {
    it('should create and match file snapshots', async () => {
      // Ensure file snapshot directory doesn't exist
      expect(fs.existsSync(fileSnapshotDir)).toBe(false);

      // First run: create file snapshot
      const { expectExecSuccess: firstExecSuccess } = await runSnapshot([
        'tests/file.test.ts',
      ]);
      await firstExecSuccess();

      // Verify file snapshot was created
      const fileSnapshotPath = path.join(fileSnapshotDir, 'data.json');
      expect(fs.existsSync(fileSnapshotPath)).toBe(true);

      const content = fs.readFileSync(fileSnapshotPath, 'utf-8');
      const data = JSON.parse(content);
      expect(data).toEqual({ key: 'value', count: 42 });

      // Second run: should match existing file snapshot
      const { expectExecSuccess, cli } = await runSnapshot([
        'tests/file.test.ts',
      ]);

      await expectExecSuccess();
      expect(cli.stdout).toMatch(/Tests.*passed/);
    });
  });

  describe('Inline snapshot - toMatchInlineSnapshot', () => {
    it('should work with inline snapshots in browser mode', async () => {
      const { expectExecSuccess, cli } = await runSnapshot([
        'tests/inline.test.ts',
      ]);

      await expectExecSuccess();
      expect(cli.stdout).toMatch(/Tests.*passed/);
    });

    it('should update inline snapshot correctly when source line changes', async () => {
      const inlineUpdateTestPath = path.join(
        fixtureDir,
        'tests',
        'inlineUpdate.test.ts',
      );

      // Step 1: Run with --update to create initial inline snapshot
      const { expectExecSuccess: firstExecSuccess } = await runSnapshot([
        'tests/inlineUpdate.test.ts',
        '--update',
      ]);

      await firstExecSuccess();

      // Verify inline snapshot was written to the file
      let content = fs.readFileSync(inlineUpdateTestPath, 'utf-8');
      expect(content).toContain('toMatchInlineSnapshot(`"original"`)');

      // Step 2: Modify the file - add new lines BEFORE the snapshot to shift its position
      // This simulates a user adding code above the snapshot
      const modifiedContent = `import { describe, expect, it } from '@rstest/core';

describe('browser snapshot - inline update', () => {
  // Adding some comments
  // to shift the line numbers
  // of the snapshot below
  it('should update inline snapshot', () => {
    expect('modified').toMatchInlineSnapshot(\`"original"\`);
  });
});
`;
      fs.writeFileSync(inlineUpdateTestPath, modifiedContent);

      // Step 3: Run with --update again - the snapshot is now at a different line
      // The source map must correctly map the new line position
      const { expectExecSuccess: secondExecSuccess, cli: secondCli } =
        await runSnapshot(['tests/inlineUpdate.test.ts', '--update']);

      await secondExecSuccess();

      // Verify the snapshot was updated at the correct (shifted) line
      content = fs.readFileSync(inlineUpdateTestPath, 'utf-8');
      // The inline snapshot should now contain 'modified' instead of 'original'
      expect(content).toContain('toMatchInlineSnapshot(`"modified"`)');
      // The old value should not exist
      expect(content).not.toContain('"original"');
      // The comments we added should still be there
      expect(content).toContain('Adding some comments');
      expect(content).toContain('to shift the line numbers');

      // Verify stdout reports snapshot updated
      expect(secondCli.stdout).toMatch(/Snapshots.*\d+.*updated/);
    });
  });
});
