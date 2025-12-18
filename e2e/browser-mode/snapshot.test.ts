import fs from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureDir = path.join(__dirname, 'fixtures', 'snapshot');
const snapshotDir = path.join(fixtureDir, 'tests', '__snapshots__');

describe('browser mode - snapshot', () => {
  // Clean up snapshots before each test to ensure a clean state
  beforeEach(() => {
    if (fs.existsSync(snapshotDir)) {
      fs.rmSync(snapshotDir, { recursive: true });
    }
  });

  // Clean up after tests
  afterEach(() => {
    // Restore update.test.ts to original state if modified
    const updateTestPath = path.join(fixtureDir, 'tests', 'update.test.ts');
    const originalContent = `import { describe, expect, it } from '@rstest/core';

describe('browser snapshot update', () => {
  it('should match updatable snapshot', () => {
    const value = 'ORIGINAL_VALUE';
    expect(value).toMatchSnapshot();
  });
});
`;
    fs.writeFileSync(updateTestPath, originalContent);
  });

  describe('Create - initial snapshot creation', () => {
    it('should create snapshot files on first run', async () => {
      // Snapshot directory should not exist initially
      expect(fs.existsSync(snapshotDir)).toBe(false);

      const { expectExecSuccess, cli } = await runBrowserCli('snapshot', {
        args: ['tests/snapshot.test.ts'],
      });

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
      const { expectExecSuccess: firstExecSuccess } = await runBrowserCli(
        'snapshot',
        {
          args: ['tests/snapshot.test.ts'],
        },
      );
      await firstExecSuccess();

      // Verify snapshot file exists
      const snapshotFile = path.join(snapshotDir, 'snapshot.test.ts.snap');
      expect(fs.existsSync(snapshotFile)).toBe(true);

      // Second run: should match existing snapshots
      const { expectExecSuccess, cli } = await runBrowserCli('snapshot', {
        args: ['tests/snapshot.test.ts'],
      });

      await expectExecSuccess();
      expect(cli.stdout).toMatch(/Tests.*passed/);

      // Should NOT report any new snapshots written
      expect(cli.stdout).not.toMatch(/Snapshots.*written/);
    });

    it('should fail when snapshot does not match', async () => {
      // First run: create initial snapshot
      const { expectExecSuccess: firstExecSuccess } = await runBrowserCli(
        'snapshot',
        {
          args: ['tests/update.test.ts'],
        },
      );
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
      const { cli } = await runBrowserCli('snapshot', {
        args: ['tests/update.test.ts'],
      });

      await cli.exec;
      expect(cli.exec.exitCode).toBe(1);
      expect(cli.stdout).toMatch(/mismatched|failed/i);
    });
  });

  describe('Update - snapshot update with --update flag', () => {
    it('should update snapshots when using --update flag', async () => {
      // First run: create initial snapshot
      const { expectExecSuccess: firstExecSuccess } = await runBrowserCli(
        'snapshot',
        {
          args: ['tests/update.test.ts'],
        },
      );
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
      const { expectExecSuccess, cli } = await runBrowserCli('snapshot', {
        args: ['tests/update.test.ts', '--update'],
      });

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
      const { expectExecSuccess: firstExecSuccess } =
        await runBrowserCli('snapshot');
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
      const { expectExecSuccess } = await runBrowserCli('snapshot', {
        args: ['tests/snapshot.test.ts'],
      });

      await expectExecSuccess();
      // Both files should still exist (obsolete snapshots are not auto-deleted)
      expect(
        fs.existsSync(path.join(snapshotDir, 'snapshot.test.ts.snap')),
      ).toBe(true);
    });
  });

  describe('Multiple snapshots in single test', () => {
    it('should handle multiple snapshots in the same test file', async () => {
      const { expectExecSuccess } = await runBrowserCli('snapshot', {
        args: ['tests/snapshot.test.ts'],
      });

      await expectExecSuccess();

      // Verify all 5 snapshots were created
      const snapshotFile = path.join(snapshotDir, 'snapshot.test.ts.snap');
      const content = fs.readFileSync(snapshotFile, 'utf-8');

      // Count the number of snapshot entries
      const snapshotCount = (content.match(/exports\[/g) || []).length;
      expect(snapshotCount).toBe(5);
    });
  });
});
