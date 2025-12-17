import path from 'node:path';
import type { TestInfo } from '@rstest/core';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import * as vscode from 'vscode';
import { watchConfigValue } from './config';
import { RstestApi } from './master';
import { TestFile, TestFolder, testData } from './testTree';

export class WorkspaceManager implements vscode.Disposable {
  public projects = new Map<string, Project>();
  private workspacePath: string;
  private testItem?: vscode.TestItem;
  private configValueWatcher: vscode.Disposable;
  constructor(
    private workspaceFolder: vscode.WorkspaceFolder,
    private testController: vscode.TestController,
  ) {
    this.workspacePath = workspaceFolder.uri.toString();
    this.configValueWatcher = this.startWatchingWorkspace();
  }
  // if this is the only one workspace, skip create test item
  public refresh(isOnlyOne: boolean) {
    if (isOnlyOne) {
      if (this.testItem) {
        this.testItem = undefined;
      }
    } else {
      if (!this.testItem) {
        this.testItem = this.testController.createTestItem(
          this.workspacePath,
          this.workspaceFolder.name,
          this.workspaceFolder.uri,
        );
        testData.set(this.testItem, this);
      }
      this.testController.items.add(this.testItem);
    }
    this.refreshAllProject();
  }
  public dispose() {
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
        this.refreshAllProject();

        // start watching config file create and delete event
        for (const pattern of patterns) {
          const watcher = vscode.workspace.createFileSystemWatcher(
            pattern,
            false,
            false,
            false,
          );
          token.onCancellationRequested(() => watcher.dispose());
          watcher.onDidCreate((file) => {
            this.handleAddConfigFile(file);
            this.refreshAllProject();
          });
          watcher.onDidDelete((file) => {
            this.handleRemoveConfigFile(file);
            this.refreshAllProject();
          });
          watcher.onDidChange((file) => {
            this.handleRemoveConfigFile(file);
            this.handleAddConfigFile(file);
            this.refreshAllProject();
          });
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
      this.testItem?.children ?? this.testController.items,
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
  private refreshAllProject() {
    const collection = this.testItem?.children ?? this.testController.items;
    collection.replace([]);
    for (const project of this.projects.values()) {
      project.refresh(this.projects.size === 1, collection);
    }
  }
}

// There is already a concept of 'project' in rstest, so we might consider changing its name here.
export class Project implements vscode.Disposable {
  api: RstestApi;
  root: vscode.Uri;
  testItem?: vscode.TestItem;
  cancellationSource: vscode.CancellationTokenSource;
  include: string[] = [];
  exclude: string[] = [];
  testFiles = new Map<string, TestFile>();
  constructor(
    private workspaceFolder: vscode.WorkspaceFolder,
    private configFileUri: vscode.Uri,
    private testController: vscode.TestController,
    public parentCollection: vscode.TestItemCollection,
  ) {
    // use dirname of config file as default root
    this.root = configFileUri.with({ path: path.dirname(configFileUri.path) });
    this.api = new RstestApi(
      workspaceFolder,
      path.dirname(configFileUri.fsPath),
      configFileUri.fsPath,
      this,
    );
    this.cancellationSource = new vscode.CancellationTokenSource();

    this.api.getNormalizedConfig().then((config) => {
      if (this.cancellationSource.token.isCancellationRequested) return;
      this.root = vscode.Uri.file(config.root);
      this.include = config.include;
      this.exclude = config.exclude;
      this.startWatchingWorkspace(this.root);
    });
  }

  public refresh(
    isOnlyOne: boolean,
    parentCollection: vscode.TestItemCollection,
  ) {
    this.parentCollection = parentCollection;
    const configFileName = path.relative(
      this.workspaceFolder.uri.fsPath,
      this.configFileUri.fsPath,
    );
    // if this is the only one project, and placed at root of workspace,
    // and matches normal config file name, skip create test item
    const skipCreateTestItem =
      isOnlyOne && configFileName.match(/^rstest\.config\.[mc]?[tj]s$/);
    if (skipCreateTestItem) {
      if (this.testItem) {
        this.testItem = undefined;
      }
    } else {
      if (!this.testItem) {
        this.testItem = this.testController.createTestItem(
          this.configFileUri.toString(),
          path.relative(this.workspaceFolder.uri.path, this.configFileUri.path),
          this.configFileUri,
        );
        testData.set(this.testItem, this);
      }
      this.parentCollection.add(this.testItem);
    }
    this.buildTree();
  }
  dispose() {
    this.api.dispose();
    this.cancellationSource.cancel();
  }
  get collection() {
    return this.testItem?.children || this.parentCollection;
  }
  private async startWatchingWorkspace(root: vscode.Uri) {
    const matchInclude = picomatch(this.include);
    const matchExclude = picomatch(this.exclude);
    const isInclude = (uri: vscode.Uri) => {
      const relativePath = path.relative(root.fsPath, uri.fsPath);
      return matchInclude(relativePath) && !matchExclude(relativePath);
    };

    const watcher = watchConfigValue(
      'testCaseCollectMethod',
      this.workspaceFolder,
      async (method, token) => {
        if (this.testItem) {
          this.testItem.busy = true;
        }
        const files: { uri: vscode.Uri; tests?: TestInfo[] }[] =
          method === 'ast'
            ? // ast
              await glob(this.include, {
                cwd: root.fsPath,
                ignore: this.exclude,
                absolute: true,
                dot: true,
                expandDirectories: false,
              }).then((files) =>
                files.map((file) => ({ uri: vscode.Uri.file(file) })),
              )
            : // runtime
              await this.api.listTests().then((files) =>
                files.map((file) => ({
                  uri: vscode.Uri.file(file.testPath),
                  tests: file.tests,
                })),
              );

        if (token.isCancellationRequested) return;

        if (this.testItem) {
          this.testItem.busy = false;
        }

        const visited = new Set<string>();
        for (const { uri, tests } of files) {
          this.updateOrCreateFile(uri, tests);
          visited.add(uri.toString());
        }

        // remove outdated items after glob configuration changed
        for (const file of this.testFiles.keys()) {
          if (!visited.has(file)) {
            this.testFiles.delete(file);
          }
        }
        this.buildTree();

        // start watching test file change
        // while createFileSystemWatcher don't support same glob syntax with tinyglobby
        // we can watch all files and filter with picomatch later
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(root, '**'),
        );
        token.onCancellationRequested(() => watcher.dispose());

        // TODO delay and batch run multiple files
        const updateOrCreateByRuntime = (uri: vscode.Uri) => {
          this.api.listTests([uri.fsPath]).then((files) => {
            if (token.isCancellationRequested) return;
            for (const { testPath, tests } of files) {
              const uri = vscode.Uri.file(testPath);
              this.updateOrCreateFile(uri, tests);
            }
            this.buildTree();
          });
        };

        watcher.onDidCreate((uri) => {
          if (isInclude(uri)) {
            if (method === 'ast') {
              this.updateOrCreateFile(uri);
              this.buildTree();
            } else {
              updateOrCreateByRuntime(uri);
            }
          }
        });
        watcher.onDidChange((uri) => {
          if (isInclude(uri)) {
            if (method === 'ast') {
              this.updateOrCreateFile(uri);
              this.buildTree();
            } else {
              updateOrCreateByRuntime(uri);
            }
          }
        });
        watcher.onDidDelete((uri) => {
          if (isInclude(uri)) {
            this.testFiles.delete(uri.toString());
            this.buildTree();
          }
        });
      },
    );
    this.cancellationSource.token.onCancellationRequested(() =>
      watcher.dispose(),
    );
  }
  // TODO pass cancellation token to updateFromDisk
  private updateOrCreateFile(uri: vscode.Uri, tests?: TestInfo[]) {
    let data = this.testFiles.get(uri.toString());
    if (!data) {
      data = new TestFile(this.api, uri, this.testController);
      this.testFiles.set(uri.toString(), data);
    }
    if (tests) {
      data.updateFromList(tests);
    } else {
      data.updateFromDisk();
    }
  }

  private buildTree() {
    type NestedRecord = { [K: string]: NestedRecord };

    const tree: NestedRecord = {};
    for (const [uriString] of this.testFiles) {
      path
        .relative(this.root.fsPath, vscode.Uri.parse(uriString).fsPath)
        .split(path.sep)
        // biome-ignore lint/suspicious/noAssignInExpressions: just simple shorthand
        .reduce((tree, segment) => (tree[segment] ||= {}), tree);
    }

    const handleTreeItem = (
      key: string,
      value: NestedRecord,
      mergedParents: string[],
      parents: string[],
      collection: vscode.TestItemCollection,
    ) => {
      const uri = vscode.Uri.file(
        [this.root.fsPath, ...parents, key].join(path.sep),
      );
      const children = Object.entries(value);

      if (children.length === 1) {
        // if folder's only child is folder, merge them into one node
        const onlyChild = children[0];
        const [childKey, childValue] = onlyChild;
        const childIsFolder = Object.entries(childValue).length !== 0;
        if (childIsFolder) {
          handleTreeItem(
            childKey,
            childValue,
            [...mergedParents, key],
            [...parents, key],
            collection,
          );
          return;
        }
      }
      const item = this.testController.createTestItem(
        uri.toString(),
        [...mergedParents, key].join(path.sep),
        uri,
      );
      collection.add(item);

      const file = this.testFiles.get(uri.toString());
      if (file) {
        file.setTestItem(item);
        testData.set(item, file);
      } else {
        testData.set(item, new TestFolder(this.api, uri));
      }

      for (const [childKey, childValue] of children) {
        handleTreeItem(
          childKey,
          childValue,
          [],
          [...parents, key],
          item.children,
        );
      }
    };

    this.collection.replace([]);
    for (const [childKey, childValue] of Object.entries(tree)) {
      handleTreeItem(childKey, childValue, [], [], this.collection);
    }
  }
}
