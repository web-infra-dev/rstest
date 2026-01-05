import vscode from 'vscode';
import { logger } from './logger';
import { runningWorkers } from './master';
import { Project, WorkspaceManager } from './project';
import { RstestFileCoverage } from './testRunReporter';
import {
  gatherTestItems,
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
}

class Rstest {
  private ctrl: vscode.TestController;
  private workspaces = new Map<string, WorkspaceManager>();
  private workspaceWatcher?: vscode.Disposable;
  private runProfile!: vscode.TestRunProfile;
  private coverageProfile!: vscode.TestRunProfile;

  // Add getter to access the test controller for testing
  get testController() {
    return this.ctrl;
  }

  constructor(context: vscode.ExtensionContext) {
    this.ctrl = vscode.tests.createTestController('rstest', 'Rstest');
    context.subscriptions.push(this.ctrl);

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

    vscode.commands.registerCommand(
      'rstest.updateSnapshot',
      (params: { test: vscode.TestItem; message: vscode.TestMessage }) =>
        this.startTestRun(
          new vscode.TestRunRequest([params.test], undefined, this.runProfile),
          new vscode.CancellationTokenSource().token,
          true,
        ),
    );

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
    }
  }

  private async handleAddWorkspace(workspaceFolder: vscode.WorkspaceFolder) {
    // ignore virtual file system
    if (workspaceFolder.uri.scheme !== 'file') return;

    this.workspaces.set(
      workspaceFolder.uri.toString(),
      new WorkspaceManager(workspaceFolder, this.ctrl),
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
          if (data.projects.size === 1) {
            const project = data.projects.values().next().value!;
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
          if (workspace.projects.size === 1) {
            const project = workspace.projects.values().next().value!;
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
