import path from 'node:path';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import * as vscode from 'vscode';
import { watchConfigValue } from './config';
import { RstestApi } from './master';
import { TestFile, TestFolder, testData, testItemType } from './testTree';
import { shouldIgnoreUri } from './utils';

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
  public refresh(onlyOne: boolean) {
    if (onlyOne) {
      if (this.testItem) {
        delete this.testItem;
      }
      this.refreshAllProject();
    } else {
      if (!this.testItem) {
        this.testItem = this.testController.createTestItem(
          this.workspacePath,
          this.workspaceFolder.name,
          this.workspaceFolder.uri,
        );
        testItemType.set(this.testItem, 'workspace');
        testData.set(this.testItem, this);
      }
      this.testController.items.add(this.testItem);
      this.refreshAllProject();
    }
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
            true, // we don't care about config file content now, so ignore change event
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
    this.root = configFileUri.with({ path: path.dirname(configFileUri.path) });
    this.api = new RstestApi(
      workspaceFolder,
      path.dirname(configFileUri.path),
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

    // TODO catch and set error
    // this.api.createChildProcess();
  }
  public refresh(onlyOne: boolean, collection: vscode.TestItemCollection) {
    this.parentCollection = collection;
    const configFileName = path.relative(
      this.workspaceFolder.uri.fsPath,
      this.configFileUri.fsPath,
    );
    const skipCreateTestItem =
      onlyOne && configFileName.match(/^rstest\.config\.[mc]?[tj]s$/);
    if (skipCreateTestItem) {
      if (this.testItem) {
        delete this.testItem;
      }
      this.build();
    } else {
      if (!this.testItem) {
        this.testItem = this.testController.createTestItem(
          this.configFileUri.toString(),
          path.relative(this.workspaceFolder.uri.path, this.configFileUri.path),
          this.configFileUri,
        );
        testItemType.set(this.testItem, 'project');
        testData.set(this.testItem, this);
        this.parentCollection.add(this.testItem);
      }
      this.build();
    }
  }
  dispose() {
    this.api.dispose();
    this.cancellationSource.cancel();
  }
  get collection() {
    return this.testItem?.children || this.parentCollection;
  }
  private async startWatchingWorkspace(root: vscode.Uri) {
    const files = await glob(this.include, {
      cwd: root.fsPath,
      ignore: this.exclude,
      absolute: true,
      dot: true,
      expandDirectories: false,
    }).then((files) => files.map((file) => vscode.Uri.file(file)));

    if (this.cancellationSource.token.isCancellationRequested) return;

    const isInclude = picomatch(this.include, { cwd: root.fsPath });
    const isExclude = picomatch(this.exclude, { cwd: root.fsPath });

    const visited = new Set<string>();
    for (const uri of files) {
      if (shouldIgnoreUri(uri) || isExclude(uri.fsPath)) continue;
      this.updateOrCreateFile(uri);
      visited.add(uri.toString());
    }

    // remove outdated items after glob configuration changed
    for (const f of this.testFiles.keys()) {
      if (!visited.has(f)) {
        this.testFiles.delete(f);
      }
    }
    this.build();

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, '**'),
    );
    this.cancellationSource.token.onCancellationRequested(() =>
      watcher.dispose(),
    );
    watcher.onDidCreate((uri) => {
      if (isInclude(uri.fsPath) && !isExclude(uri.fsPath)) {
        this.updateOrCreateFile(uri);
        this.build();
      }
    });
    watcher.onDidChange((uri) => {
      if (isInclude(uri.fsPath) && !isExclude(uri.fsPath)) {
        this.updateOrCreateFile(uri);
        this.build();
      }
    });
    watcher.onDidDelete((uri) => {
      if (isInclude(uri.path) && !isExclude(uri.path)) {
        this.testFiles.delete(uri.toString());
        this.build();
      }
    });
  }
  // TODO pass cancellation token to updateFromDisk
  private updateOrCreateFile(uri: vscode.Uri) {
    const existing = this.testFiles.get(uri.toString());
    if (existing) {
      existing.updateFromDisk(this.testController);
    } else {
      const data = new TestFile(this.api, uri);
      this.testFiles.set(uri.toString(), data);
      data.updateFromDisk(this.testController);
    }
  }

  private build() {
    this.collection.replace([]);
    type NestRecord = { [K: string]: NestRecord };
    const map: NestRecord = {};
    for (const [uriString] of this.testFiles) {
      path
        .relative(this.root.fsPath, vscode.Uri.parse(uriString).fsPath)
        .split(path.sep)
        // biome-ignore lint/suspicious/noAssignInExpressions: xxx
        .reduce((map, segment) => (map[segment] ||= {}), map);
    }
    const handle = (
      key: string,
      value: NestRecord,
      parents: string[],
      allParents: string[],
      collection: vscode.TestItemCollection,
    ) => {
      const uri = vscode.Uri.file(
        [this.root.fsPath, ...allParents, key].join(path.sep),
      );
      const children = Object.entries(value);
      if (
        children.length === 1 &&
        Object.entries(children[0][1]).length !== 0
      ) {
        const onlyChild = children[0];
        const [childKey, childValue] = onlyChild;
        if (Object.entries(childValue).length !== 0) {
          handle(
            childKey,
            childValue,
            [...parents, key],
            [...allParents, key],
            collection,
          );
          return;
        }
      }
      const item = this.testController.createTestItem(
        uri.toString(),
        [...parents, key].join(path.sep),
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
        handle(childKey, childValue, [], [...allParents, key], item.children);
      }
    };
    for (const [childKey, childValue] of Object.entries(map)) {
      handle(childKey, childValue, [], [], this.collection);
    }
  }
}
