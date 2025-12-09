import path from 'node:path';
import * as vscode from 'vscode';
import { watchConfigValue } from './config';
import { RstestApi } from './master';
import { TestFile, testData, testItemType } from './testTree';
import { shouldIgnoreUri } from './utils';

export class WorkspaceManager implements vscode.Disposable {
  private projects = new Map<string, Project>();
  private workspacePath: string;
  private testItem: vscode.TestItem;
  private configValueWatcher: vscode.Disposable;
  constructor(
    private workspaceFolder: vscode.WorkspaceFolder,
    private testController: vscode.TestController,
  ) {
    this.workspacePath = workspaceFolder.uri.toString();
    this.testItem = testController.createTestItem(
      this.workspacePath,
      workspaceFolder.name,
      workspaceFolder.uri,
    );
    testItemType.set(this.testItem, 'workspace');
    testController.items.add(this.testItem);
    this.configValueWatcher = this.startWatchingWorkspace();
  }
  public dispose() {
    this.testController.items.delete(this.workspacePath);
    for (const project of this.projects.values()) {
      project.dispose();
    }
    this.configValueWatcher.dispose();
  }
  private startWatchingWorkspace() {
    return watchConfigValue(
      'configFileGlobPattern',
      this.workspaceFolder,
      async (globs, token) => {
        const patterns = globs.map(
          (glob) => new vscode.RelativePattern(this.workspaceFolder, glob),
        );

        // find all config file
        const files = (
          await Promise.all(
            patterns.map((pattern) =>
              vscode.workspace.findFiles(
                pattern,
                '**/node_modules/**',
                undefined,
                token,
              ),
            ),
          )
        ).flat();

        const visited = new Set<string>();
        for (const file of files) {
          this.handleAddConfigFile(file);
          visited.add(file.toString());
        }
        // remove outdated items after glob configuration changed
        for (const [configFilePath, project] of this.projects) {
          if (!visited.has(configFilePath)) {
            project.dispose();
            this.projects.delete(configFilePath);
          }
        }

        // start watching config file create and delete event
        for (const pattern of patterns) {
          const watcher = vscode.workspace.createFileSystemWatcher(
            pattern,
            false,
            true, // we don't care about config file content now, so ignore change event
            false,
          );
          token.onCancellationRequested(() => watcher.dispose());
          watcher.onDidCreate((file) => this.handleAddConfigFile(file));
          watcher.onDidDelete((file) => this.handleRemoveConfigFile(file));
        }
      },
    );
  }
  private handleAddConfigFile(configFileUri: vscode.Uri) {
    const configFilePath = configFileUri.toString();
    if (this.projects.has(configFilePath)) return;
    const project = new Project(
      this.workspaceFolder,
      configFileUri,
      this.testController,
      this.testItem,
    );
    this.projects.set(configFilePath, project);
  }
  private handleRemoveConfigFile(configFileUri: vscode.Uri) {
    const configFilePath = configFileUri.toString();
    const project = this.projects.get(configFilePath);
    if (!project) return;
    project.dispose();
    this.projects.delete(configFilePath);
  }
}

// There is already a concept of 'project' in rstest, so we might consider changing its name here.
export class Project implements vscode.Disposable {
  api: RstestApi;
  root: vscode.Uri;
  projectTestItem: vscode.TestItem;
  configValueWatcher: vscode.Disposable;
  constructor(
    workspaceFolder: vscode.WorkspaceFolder,
    private configFileUri: vscode.Uri,
    private testController: vscode.TestController,
    private workspaceTestItem: vscode.TestItem,
  ) {
    // TODO get root from config
    this.root = configFileUri.with({ path: path.dirname(configFileUri.path) });
    this.api = new RstestApi(
      workspaceFolder,
      this.root.fsPath,
      configFileUri.fsPath,
    );

    // TODO skip createTestItem if there is only one configFile in the workspace and it is located in the root directory
    this.projectTestItem = testController.createTestItem(
      configFileUri.toString(),
      path.relative(workspaceFolder.uri.path, configFileUri.path),
      configFileUri,
    );
    testItemType.set(this.projectTestItem, 'project');
    workspaceTestItem.children.add(this.projectTestItem);
    // TODO catch and set error
    this.api.createChildProcess();

    this.configValueWatcher = this.startWatchingWorkspace();
  }
  dispose() {
    this.workspaceTestItem.children.delete(this.configFileUri.toString());
    this.configValueWatcher.dispose();
    this.api.dispose();
  }
  private startWatchingWorkspace() {
    // TODO read config from config file, or scan files with rstest internal api directly
    return watchConfigValue(
      'testFileGlobPattern',
      this.root,
      async (globs, token) => {
        const patterns = globs.map(
          (glob) => new vscode.RelativePattern(this.root, glob),
        );

        const files = (
          await Promise.all(
            patterns.map((pattern) =>
              vscode.workspace.findFiles(
                pattern,
                '**/node_modules/**',
                undefined,
                token,
              ),
            ),
          )
        ).flat();

        const visited = new Set<string>();
        for (const uri of files) {
          if (shouldIgnoreUri(uri)) continue;
          this.updateOrCreateFile(uri);
          visited.add(uri.toString());
        }

        // remove outdated items after glob configuration changed
        this.projectTestItem.children.forEach((testItem) => {
          if (!visited.has(testItem.id)) {
            this.projectTestItem.children.delete(testItem.id);
          }
        });

        // start watching test file change
        for (const pattern of patterns) {
          const watcher = vscode.workspace.createFileSystemWatcher(
            pattern,
            false,
            false,
            false,
          );

          token.onCancellationRequested(() => watcher.dispose());
          watcher.onDidCreate((uri) => {
            if (shouldIgnoreUri(uri)) return;
            this.updateOrCreateFile(uri);
          });
          watcher.onDidChange((uri) => {
            if (shouldIgnoreUri(uri)) return;
            this.updateOrCreateFile(uri);
          });
          watcher.onDidDelete((uri) => {
            this.projectTestItem.children.delete(uri.toString());
          });
        }
      },
    );
  }
  // TODO pass cancellation token to updateFromDisk
  private updateOrCreateFile(uri: vscode.Uri) {
    const existing = this.projectTestItem.children.get(uri.toString());
    if (existing) {
      (testData.get(existing) as TestFile).updateFromDisk(
        this.testController,
        existing,
      );
    } else {
      const file = this.testController.createTestItem(
        uri.toString(),
        path.basename(uri.path),
        uri,
      );
      testItemType.set(file, 'file');
      this.projectTestItem.children.add(file);

      const data = new TestFile(this.api);
      testData.set(file, data);
      data.updateFromDisk(this.testController, file);

      file.canResolveChildren = true;
    }
  }
}
