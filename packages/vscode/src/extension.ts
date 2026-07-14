import vscode from 'vscode';
import { RstestDiagnostics } from './diagnostics';
import { TestErrorStore, testMessageText } from './errorStore';
import { logger } from './logger';
import { runningWorkers } from './master';
import { Project, WorkspaceManager } from './project';
import { disposeTerminal } from './terminal';
import { RstestFileCoverage } from './testRunReporter';
import {
  gatherTestItems,
  ProjectFolder,
  TestCase,
  TestFile,
  TestFolder,
  testData,
} from './testTree';

export async function activate(context: vscode.ExtensionContext) {
  const rstest = new Rstest(context);
  return rstest;
}

export function deactivate() {
  for (const worker of runningWorkers) {
    worker.$close();
  }
  disposeTerminal();
}

class Rstest {
  private context: vscode.ExtensionContext;
  private ctrl: vscode.TestController;
  private workspaces = new Map<string, WorkspaceManager>();
  private workspaceWatcher?: vscode.Disposable;
  private runProfile!: vscode.TestRunProfile;
  private coverageProfile!: vscode.TestRunProfile;
  private diagnostics = new RstestDiagnostics();
  private errorStore = new TestErrorStore();

  // Add getter to access the test controller for testing
  get testController() {
    return this.ctrl;
  }

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.ctrl = vscode.tests.createTestController('rstest', 'Rstest');
    context.subscriptions.push(this.ctrl);
    context.subscriptions.push(this.diagnostics);
    context.subscriptions.push(logger);

    this.startScanWorkspaces();
    this.setupTestController();
  }

  private setupTestController() {
    this.ctrl.refreshHandler = () => this.startScanWorkspaces();

    this.runProfile = this.ctrl.createRunProfile(
      'Run Tests',
      vscode.TestRunProfileKind.Run,
      this.startTestRun,
      true,
      undefined,
      true,
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        'rstest.updateSnapshot',
        (params: { test: vscode.TestItem; message: vscode.TestMessage }) => {
          const cancellation = new vscode.CancellationTokenSource();
          return this.startTestRun(
            new vscode.TestRunRequest(
              [params.test],
              undefined,
              this.runProfile,
            ),
            cancellation.token,
            true,
          ).finally(() => cancellation.dispose());
        },
      ),
    );

    this.registerCommands();

    this.ctrl.createRunProfile(
      'Debug Tests',
      vscode.TestRunProfileKind.Debug,
      this.startTestRun,
      true,
      undefined,
      true,
    );

    this.coverageProfile = this.ctrl.createRunProfile(
      'Run Tests with Coverage',
      vscode.TestRunProfileKind.Coverage,
      this.startTestRun,
      true,
      undefined,
      true,
    );

    this.coverageProfile.loadDetailedCoverage = async (_testRun, coverage) => {
      if (coverage instanceof RstestFileCoverage) {
        return coverage.details;
      }
      return [];
    };
  }

  private registerCommands() {
    const register = (
      command: string,
      callback: (...args: any[]) => unknown,
    ) => {
      this.context.subscriptions.push(
        vscode.commands.registerCommand(command, callback),
      );
    };

    register('rstest.openOutput', () => logger.show());

    register('rstest.revealInTestExplorer', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      const item = target && this.findTestFileItem(target);
      if (!item) {
        vscode.window.showInformationMessage(
          'This file is not a known Rstest test file.',
        );
        return;
      }
      await vscode.commands.executeCommand('vscode.revealTestInExplorer', item);
    });

    register(
      'rstest.copyErrorOutput',
      async (args?: { test: vscode.TestItem; message: vscode.TestMessage }) => {
        if (!args?.message) return;
        await vscode.env.clipboard.writeText(testMessageText(args.message));
      },
    );

    register('rstest.runInTerminal', (testItem?: vscode.TestItem) => {
      if (!testItem) return;
      const data = testData.get(testItem);
      if (data instanceof TestCase) {
        data.api.runInTerminal({
          fileFilter: data.uri.fsPath,
          testCaseNamePath: data.parentNames.concat(testItem.label),
          isSuite: data.type === 'suite',
        });
      } else if (data instanceof TestFile || data instanceof TestFolder) {
        data.api.runInTerminal({ fileFilter: data.uri.fsPath });
      } else if (data instanceof Project) {
        data.api.runInTerminal({});
      } else {
        vscode.window.showInformationMessage(
          'Run in Terminal is not available for this item.',
        );
      }
    });

    register(
      'rstest.copyTestItemErrors',
      async (testItem?: vscode.TestItem) => {
        if (!testItem) return;
        const errors = this.collectErrors(testItem);
        if (!errors.length) {
          vscode.window.showInformationMessage('No test errors to copy.');
          return;
        }
        await vscode.env.clipboard.writeText(errors.join('\n\n'));
      },
    );
  }

  // Errors for a test item plus any descendants (a file/suite item aggregates
  // its leaves' failures).
  private collectErrors(item: vscode.TestItem): string[] {
    const errors: string[] = [];
    for (const test of [item, ...gatherTestItems(item.children)]) {
      for (const message of this.errorStore.get(test)) {
        errors.push(testMessageText(message));
      }
    }
    return errors;
  }

  private findTestFileItem(uri: vscode.Uri): vscode.TestItem | undefined {
    const key = uri.toString();
    for (const workspace of this.workspaces.values()) {
      for (const project of workspace.projects.values()) {
        const item = project.testFiles.get(key)?.testItem;
        if (item) return item;
      }
    }
    return undefined;
  }

  private updateTestFilesContext() {
    const paths: string[] = [];
    for (const workspace of this.workspaces.values()) {
      for (const project of workspace.projects.values()) {
        for (const file of project.testFiles.values()) {
          paths.push(file.uri.fsPath);
        }
      }
    }
    vscode.commands.executeCommand('setContext', 'rstest.testFiles', paths);
  }

  private startScanWorkspaces() {
    // dispose previous data on refresh
    for (const [workspacePath, workspace] of this.workspaces) {
      workspace.dispose();
      this.workspaces.delete(workspacePath);
    }
    // collect all workspaces
    for (const workspace of vscode.workspace.workspaceFolders || []) {
      this.handleAddWorkspace(workspace);
    }
    this.refreshAllWorkspaces();
    // start watching workspace change
    if (!this.workspaceWatcher) {
      this.workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(
        (e) => {
          for (const added of e.added) {
            this.handleAddWorkspace(added);
          }
          for (const removed of e.removed) {
            this.handleRemoveWorkspace(removed);
          }
          this.refreshAllWorkspaces();
        },
      );
      this.context.subscriptions.push(this.workspaceWatcher);
    }
  }

  private async handleAddWorkspace(workspaceFolder: vscode.WorkspaceFolder) {
    // ignore virtual file system
    if (workspaceFolder.uri.scheme !== 'file') return;

    this.workspaces.set(
      workspaceFolder.uri.toString(),
      new WorkspaceManager(workspaceFolder, this.ctrl, () =>
        this.updateTestFilesContext(),
      ),
    );
  }

  private handleRemoveWorkspace(workspaceFolder: vscode.WorkspaceFolder) {
    const workspacePath = workspaceFolder.uri.toString();
    const workspace = this.workspaces.get(workspacePath);
    if (!workspace) return;
    workspace.dispose();
    this.workspaces.delete(workspaceFolder.uri.toString());
  }

  private refreshAllWorkspaces() {
    this.ctrl.items.replace([]);
    for (const workspace of this.workspaces.values()) {
      workspace.refresh(vscode.workspace.workspaceFolders?.length === 1);
    }
    this.updateTestFilesContext();
  }

  private startTestRun = async (
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    updateSnapshot?: boolean,
    // used by e2e tests
    createTestRun = this.ctrl.createTestRun.bind(this.ctrl),
  ) => {
    const run = createTestRun(request);
    const enqueuedTests = (tests: readonly vscode.TestItem[]) => {
      for (const test of tests) {
        if (request.exclude?.includes(test)) {
          continue;
        }
        const data = testData.get(test);
        if (data instanceof TestFile || data instanceof TestCase) {
          run.enqueued(test);
        }
        enqueuedTests(gatherTestItems(test.children, false));
      }
    };

    enqueuedTests(request.include ?? gatherTestItems(this.ctrl.items, false));

    const commonOptions = {
      run,
      token,
      updateSnapshot,
      kind: request.profile?.kind,
      continuous: request.continuous,
      diagnostics: this.diagnostics,
      errorStore: this.errorStore,
      createTestRun: () =>
        createTestRun(
          new vscode.TestRunRequest(
            request.include,
            request.exclude,
            request.profile,
            request.continuous,
            request.preserveFocus,
          ),
        ),
    };

    const discoverTests = async (tests: readonly vscode.TestItem[]) => {
      for (const test of tests) {
        if (request.exclude?.includes(test)) {
          continue;
        }

        const data = testData.get(test);
        if (data instanceof WorkspaceManager) {
          if (data.activeProjects.size === 1) {
            const project = data.activeProjects.values().next().value!;
            await project.api.runTest({
              ...commonOptions,
            });
          } else {
            await discoverTests(gatherTestItems(test.children, false));
          }
        } else if (data instanceof Project) {
          await data.api.runTest({
            ...commonOptions,
          });
        } else if (data instanceof ProjectFolder) {
          // grouping folder spans multiple projects; recurse into children
          await discoverTests(gatherTestItems(test.children, false));
        } else if (data instanceof TestFolder) {
          await data.api.runTest({
            ...commonOptions,
            fileFilter: data.uri.fsPath,
          });
        } else if (data instanceof TestFile) {
          await data.api.runTest({
            ...commonOptions,
            fileFilter: data.uri.fsPath,
          });
        } else if (data instanceof TestCase) {
          await data.api.runTest({
            ...commonOptions,
            fileFilter: data.uri.fsPath,
            testCaseNamePath: data.parentNames.concat(test.label),
            isSuite: data.type === 'suite',
          });
        }
      }
    };

    try {
      if (!request.include?.length) {
        if (this.workspaces.size === 1) {
          const workspace = this.workspaces.values().next().value!;
          if (workspace.activeProjects.size === 1) {
            const project = workspace.activeProjects.values().next().value!;
            await project.api.runTest({
              ...commonOptions,
            });
            return;
          }
        }
      }
      await discoverTests(
        request.include ?? gatherTestItems(this.ctrl.items, false),
      );
    } catch (error) {
      logger.error('Error running tests:', error);
    } finally {
      run.end();
    }
  };
}
