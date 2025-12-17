import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import { toLabelTree, waitFor } from './helpers';

suite('Workspace discover suite', () => {
  test('Extension should discover workspaces and projects', async () => {
    // Check if the extension is activated
    const extension = vscode.extensions.getExtension('rstack.rstest');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Get the rstest test controller that the extension should have created
    const rstestInstance = extension?.exports;
    const testController: vscode.TestController =
      rstestInstance?.testController;

    const config = vscode.workspace.getConfiguration('rstest');
    const fixturesRoot = path.resolve(__dirname, '../../tests/fixtures');

    // initial workspaces
    await waitFor(() => {
      assert.deepStrictEqual(toLabelTree(testController.items, true), [
        {
          label: 'test',
          children: [
            { label: 'each.test.ts' },
            { label: 'foo.test.ts' },
            { label: 'index.test.ts' },
            { label: 'jsFile.spec.js' },
            { label: 'jsxFile.test.jsx' },
            { label: 'progress.test.ts' },
            { label: 'tsxFile.test.tsx' },
          ],
        },
      ]);
    });

    // add workspace-2
    vscode.workspace.updateWorkspaceFolders(
      vscode.workspace.workspaceFolders?.length || 0,
      0,
      {
        uri: vscode.Uri.file(path.resolve(fixturesRoot, 'workspace-2')),
      },
    );
    await waitFor(() => {
      assert.deepStrictEqual(toLabelTree(testController.items, true), [
        {
          label: 'workspace-1',
          children: [
            {
              label: 'test',
              children: [
                { label: 'each.test.ts' },
                { label: 'foo.test.ts' },
                { label: 'index.test.ts' },
                { label: 'jsFile.spec.js' },
                { label: 'jsxFile.test.jsx' },
                { label: 'progress.test.ts' },
                { label: 'tsxFile.test.tsx' },
              ],
            },
          ],
        },
        {
          label: 'workspace-2',
          children: [
            {
              label: 'folder/project-2/rstest.config.ts',
              children: [
                {
                  label: 'test',
                  children: [{ label: 'foo.test.ts' }],
                },
              ],
            },
            {
              label: 'project-1/rstest.config.ts',
              children: [
                {
                  label: 'test',
                  children: [{ label: 'foo.test.ts' }],
                },
              ],
            },
          ],
        },
      ]);
    });

    // remove config file
    await fs.rename(
      path.resolve(fixturesRoot, 'workspace-2/project-1/rstest.config.ts'),
      path.resolve(fixturesRoot, 'workspace-2/project-1/foo.config.ts'),
    );
    await fs.rename(
      path.resolve(
        fixturesRoot,
        'workspace-2/folder/project-2/rstest.config.ts',
      ),
      path.resolve(fixturesRoot, 'workspace-2/folder/project-2/bar.config.ts'),
    );
    await waitFor(() => {
      assert.deepStrictEqual(toLabelTree(testController.items, true), [
        {
          label: 'workspace-1',
          children: [
            {
              label: 'test',
              children: [
                { label: 'each.test.ts' },
                { label: 'foo.test.ts' },
                { label: 'index.test.ts' },
                { label: 'jsFile.spec.js' },
                { label: 'jsxFile.test.jsx' },
                { label: 'progress.test.ts' },
                { label: 'tsxFile.test.tsx' },
              ],
            },
          ],
        },
        {
          label: 'workspace-2',
        },
      ]);
    });

    // change configFileGlobPattern
    await config.update('configFileGlobPattern', [
      '**/foo.config.{mjs,ts,js,cjs,mts,cts}',
    ]);
    await waitFor(() => {
      assert.deepStrictEqual(toLabelTree(testController.items, true), [
        {
          label: 'workspace-1',
        },
        {
          label: 'workspace-2',
          children: [
            {
              label: 'project-1/foo.config.ts',
              children: [
                {
                  label: 'test',
                  children: [{ label: 'foo.test.ts' }],
                },
              ],
            },
          ],
        },
      ]);
    });

    // add config file
    await fs.rename(
      path.resolve(fixturesRoot, 'workspace-2/folder/project-2/bar.config.ts'),
      path.resolve(fixturesRoot, 'workspace-2/folder/project-2/foo.config.ts'),
    );
    await waitFor(() => {
      assert.deepStrictEqual(toLabelTree(testController.items, true), [
        {
          label: 'workspace-1',
        },
        {
          label: 'workspace-2',
          children: [
            {
              label: 'folder/project-2/foo.config.ts',
              children: [
                {
                  label: 'test',
                  children: [{ label: 'foo.test.ts' }],
                },
              ],
            },
            {
              label: 'project-1/foo.config.ts',
              children: [
                {
                  label: 'test',
                  children: [{ label: 'foo.test.ts' }],
                },
              ],
            },
          ],
        },
      ]);
    });

    // restore config file and configFileGlobPattern
    await fs.rename(
      path.resolve(fixturesRoot, 'workspace-2/project-1/foo.config.ts'),
      path.resolve(fixturesRoot, 'workspace-2/project-1/rstest.config.ts'),
    );
    await fs.rename(
      path.resolve(fixturesRoot, 'workspace-2/folder/project-2/foo.config.ts'),
      path.resolve(
        fixturesRoot,
        'workspace-2/folder/project-2/rstest.config.ts',
      ),
    );
    await config.update('configFileGlobPattern', undefined);
    await waitFor(() => {
      assert.deepStrictEqual(toLabelTree(testController.items, true), [
        {
          label: 'workspace-1',
          children: [
            {
              label: 'test',
              children: [
                { label: 'each.test.ts' },
                { label: 'foo.test.ts' },
                { label: 'index.test.ts' },
                { label: 'jsFile.spec.js' },
                { label: 'jsxFile.test.jsx' },
                { label: 'progress.test.ts' },
                { label: 'tsxFile.test.tsx' },
              ],
            },
          ],
        },
        {
          label: 'workspace-2',
          children: [
            {
              label: 'folder/project-2/rstest.config.ts',
              children: [
                {
                  label: 'test',
                  children: [{ label: 'foo.test.ts' }],
                },
              ],
            },
            {
              label: 'project-1/rstest.config.ts',
              children: [
                {
                  label: 'test',
                  children: [{ label: 'foo.test.ts' }],
                },
              ],
            },
          ],
        },
      ]);
    });

    // remove workspace-2
    vscode.workspace.updateWorkspaceFolders(1, 1);

    await waitFor(() => {
      assert.deepStrictEqual(toLabelTree(testController.items, true), [
        {
          label: 'test',
          children: [
            { label: 'each.test.ts' },
            { label: 'foo.test.ts' },
            { label: 'index.test.ts' },
            { label: 'jsFile.spec.js' },
            { label: 'jsxFile.test.jsx' },
            { label: 'progress.test.ts' },
            { label: 'tsxFile.test.tsx' },
          ],
        },
      ]);
    });
  });
});
