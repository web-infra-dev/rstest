import vscode from 'vscode';
import { logger } from './logger';
import { WorkspaceManager } from './project';
import {
  gatherTestItems,
  getContentFromFilesystem,
  TestCase,
  TestFile,
  testData,
} from './testTree';

export async function activate(context: vscode.ExtensionContext) {
  const rstest = new Rstest(context);
  return rstest;
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
      (request) => this.startTestRun(request),
      true,
      undefined,
      false,
    );

    vscode.commands.registerCommand(
      'rstest.updateSnapshot',
      (params: { test: vscode.TestItem; message: vscode.TestMessage }) =>
        this.startTestRun(
          new vscode.TestRunRequest([params.test], undefined, this.runProfile),
          true,
        ),
    );

    this.coverageProfile = this.ctrl.createRunProfile(
      'Run with Coverage',
      vscode.TestRunProfileKind.Coverage,
      (request) => this.startTestRun(request),
      true,
      undefined,
      false,
    );

    this.coverageProfile.loadDetailedCoverage = async (_testRun, coverage) => {
      if (coverage instanceof RstestFileCoverage) {
        return coverage.coveredLines.filter(
          (l): l is vscode.StatementCoverage => !!l,
        );
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

  private startTestRun = (
    request: vscode.TestRunRequest,
    updateSnapshot?: boolean,
    run = this.ctrl.createTestRun(request),
  ) => {
    // map of file uris to statements on each line:
    const coveredLines = new Map<
      /* file uri */ string,
      (vscode.StatementCoverage | undefined)[]
    >();

    const enqueuedTests = (tests: readonly vscode.TestItem[]) => {
      for (const test of tests) {
        if (request.exclude?.includes(test)) {
          continue;
        }
        run.enqueued(test);
        enqueuedTests(gatherTestItems(test.children, false));
      }
    };

    enqueuedTests(request.include ?? gatherTestItems(this.ctrl.items, false));

    const discoverTests = async (tests: readonly vscode.TestItem[]) => {
      for (const test of tests) {
        if (request.exclude?.includes(test)) {
          continue;
        }

        const data = testData.get(test);
        if (data instanceof TestCase) {
          run.started(test);
          await data.run(test, run, updateSnapshot);
        } else if (data instanceof TestFile) {
          if (!data.didResolve) {
            await data.updateFromDisk(this.ctrl, test);
            enqueuedTests(gatherTestItems(test.children, false));
          }

          // Run all tests for this file at once
          run.started(test);
          await data.run(test, run, updateSnapshot, this.ctrl);
        } else {
          // Process child tests
          await discoverTests(gatherTestItems(test.children, false));
        }

        if (
          test.uri &&
          !coveredLines.has(test.uri.toString()) &&
          request.profile?.kind === vscode.TestRunProfileKind.Coverage
        ) {
          try {
            const lines = (await getContentFromFilesystem(test.uri)).split(
              '\n',
            );
            coveredLines.set(
              test.uri.toString(),
              lines.map((lineText, lineNo) =>
                lineText.trim().length
                  ? new vscode.StatementCoverage(
                      0,
                      new vscode.Position(lineNo, 0),
                    )
                  : undefined,
              ),
            );
          } catch {
            // ignored
          }
        }
      }
    };

    discoverTests(request.include ?? gatherTestItems(this.ctrl.items, false))
      .catch((error) => {
        logger.error('Error running tests:', error);
      })
      .finally(() => run.end());
  };
}

class RstestFileCoverage extends vscode.FileCoverage {
  constructor(
    uri: string,
    public readonly coveredLines: (vscode.StatementCoverage | undefined)[],
  ) {
    super(vscode.Uri.parse(uri), new vscode.TestCoverageCount(0, 0));
    for (const line of coveredLines) {
      if (line) {
        this.statementCoverage.covered += line.executed ? 1 : 0;
        this.statementCoverage.total++;
      }
    }
  }
}
