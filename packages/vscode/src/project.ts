import path from 'node:path';
import type { TestInfo } from '@rstest/core';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import vscode from 'vscode';
import { watchConfigValue } from './config';
import { logger } from './logger';
import { RstestApi } from './master';
import { ProjectFolder, TestFile, TestFolder, testData } from './testTree';

// The default config file name at the workspace root. A lone project using it
// is shown without a project node (its test files sit directly under the root).
const DEFAULT_ROOT_CONFIG_RE = /^rstest\.config\.[mc]?[tj]s$/;

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

    // Standard single-project setup (one project using the default config name
    // at the workspace root): show its test files directly, with no project node.
    if (this.projects.size === 1) {
      const [[configFilePath, project]] = this.projects;
      const relative = path.relative(
        this.workspaceFolder.uri.fsPath,
        vscode.Uri.parse(configFilePath).fsPath,
      );
      if (DEFAULT_ROOT_CONFIG_RE.test(relative)) {
        project.refresh(collection, null);
        return;
      }
    }

    this.buildProjectTree(collection);
  }

  // Group projects into a folder tree by their config file directory, so the
  // project level nests like the file level instead of showing a flat list of
  // `dir/rstest.config.ts` entries. A project is shown as its own directory
  // (e.g. `packages/core`); the config file name is only used to disambiguate
  // a root-level config or multiple configs sharing one directory.
  private buildProjectTree(rootCollection: vscode.TestItemCollection) {
    type TreeNode = { children: Map<string, TreeNode>; project?: Project };
    const root: TreeNode = { children: new Map() };

    for (const [configFilePath, project] of this.projects) {
      const relative = path.relative(
        this.workspaceFolder.uri.fsPath,
        vscode.Uri.parse(configFilePath).fsPath,
      );
      let node = root;
      for (const segment of relative.split(path.sep)) {
        let next = node.children.get(segment);
        if (!next) {
          next = { children: new Map() };
          node.children.set(segment, next);
        }
        node = next;
      }
      node.project = project;
    }

    const handleTreeItem = (
      key: string,
      node: TreeNode,
      mergedParents: string[],
      parents: string[],
      collection: vscode.TestItemCollection,
    ) => {
      const children = [...node.children];

      // Collapse single-child chains: a directory with exactly one child merges
      // into it, whether the child is another directory or the project's config
      // file, so `packages/core/rstest.config.ts` shows as one `packages/core`
      // project node.
      if (children.length === 1) {
        const [childKey, childNode] = children[0];
        handleTreeItem(
          childKey,
          childNode,
          [...mergedParents, key],
          [...parents, key],
          collection,
        );
        return;
      }

      if (node.project) {
        // The config file node: label it by its directory (mergedParents), and
        // fall back to the file name only when it has no directory of its own
        // (a root-level config, or configs sharing a directory).
        const label = mergedParents.join(path.sep) || key;
        node.project.refresh(collection, label);
        return;
      }

      const label = [...mergedParents, key].join(path.sep);
      const uri = vscode.Uri.file(
        path.join(this.workspaceFolder.uri.fsPath, ...parents, key),
      );
      const item = this.testController.createTestItem(
        uri.toString(),
        label,
        uri,
      );
      collection.add(item);
      testData.set(item, new ProjectFolder());

      for (const [childKey, childNode] of children) {
        handleTreeItem(
          childKey,
          childNode,
          [],
          [...parents, key],
          item.children,
        );
      }
    };

    for (const [key, node] of root.children) {
      handleTreeItem(key, node, [], [], rootCollection);
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

    void this.api
      .getNormalizedConfig()
      .then((config) => {
        if (this.cancellationSource.token.isCancellationRequested) return;
        this.root = vscode.Uri.file(config.root);
        this.include = config.include;
        this.exclude = config.exclude;
        this.startWatchingWorkspace(this.root);
      })
      .catch((error) => {
        if (this.cancellationSource.token.isCancellationRequested) return;
        logger.error('Failed to initialize project config', error);
      });
  }

  // `label` is the project node's label, or `null` to hoist its test files
  // directly under `parentCollection` with no project node (the standard
  // single-project case). The layout decision is owned by `WorkspaceManager`.
  public refresh(
    parentCollection: vscode.TestItemCollection,
    label: string | null,
  ) {
    this.parentCollection = parentCollection;
    if (label === null) {
      this.testItem = undefined;
    } else {
      if (!this.testItem) {
        this.testItem = this.testController.createTestItem(
          this.configFileUri.toString(),
          label,
          // Do not set `uri`, so that VSCode’s “Run Tests” works correctly.
          // https://github.com/microsoft/vscode/blob/3b42759b8b501e68106c72b5683dcc114ed789e1/src/vs/workbench/contrib/testing/common/testService.ts#L278-L280
        );
        testData.set(this.testItem, this);
      }
      // label may change across refreshes as the surrounding project tree
      // gains or loses siblings
      this.testItem.label = label;
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
        try {
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
            void this.api
              .listTests([uri.fsPath])
              .then((files) => {
                if (token.isCancellationRequested) return;
                for (const { testPath, tests } of files) {
                  const uri = vscode.Uri.file(testPath);
                  this.updateOrCreateFile(uri, tests);
                }
                this.buildTree();
              })
              .catch((error) => {
                if (!token.isCancellationRequested) {
                  logger.error('Failed to update runtime test list', error);
                }
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
        } catch (error) {
          if (!token.isCancellationRequested) {
            logger.error('Failed to collect test files', error);
          }
        } finally {
          if (this.testItem) {
            this.testItem.busy = false;
          }
        }
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
        .reduce((tree, segment) => (tree[segment] ||= {}), tree);
    }

    const handleTreeItem = (
      key: string,
      value: NestedRecord,
      mergedParents: string[],
      parents: string[],
      collection: vscode.TestItemCollection,
    ) => {
      const uri = vscode.Uri.file(path.join(this.root.fsPath, ...parents, key));
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
