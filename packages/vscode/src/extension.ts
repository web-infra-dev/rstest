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
  private context: vscode.ExtensionContext;
  private ctrl: vscode.TestController;
  private workspaces = new Map<string, WorkspaceManager>();
  private workspaceWatcher?: vscode.Disposable;

  // Add getter to access the test controller for testing
  get testController() {
    return this.ctrl;
  }

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.ctrl = vscode.tests.createTestController('rstest', 'Rstest');
    context.subscriptions.push(this.ctrl);

    this.startScanWorkspaces();
    this.setupTestController();
  }

  private setupTestController() {
    const runHandler = (
      request: vscode.TestRunRequest,
      _cancellation: vscode.CancellationToken,
    ) => {
      if (request.continuous) {
        vscode.window.showInformationMessage(
          'Continuous run is not implemented yet.',
        );
        return; // Early return; do nothing for continuous run
      }

      return this.startTestRun(request);
    };

    const _runProfile = this.ctrl.createRunProfile(
      'Run Tests',
      vscode.TestRunProfileKind.Run,
      runHandler,
      true,
      undefined,
      false,
    );

    const coverageProfile = this.ctrl.createRunProfile(
      'Run with Coverage',
      vscode.TestRunProfileKind.Coverage,
      runHandler,
      true,
      undefined,
      false,
    );

    coverageProfile.loadDetailedCoverage = async (_testRun, coverage) => {
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

  private startTestRun = (request: vscode.TestRunRequest) => {
    // const queue: { test: vscode.TestItem; data: TestCase }[] = [];
    const run = this.ctrl.createTestRun(request);
    // map of file uris to statements on each line:
    const coveredLines = new Map<
      /* file uri */ string,
      (vscode.StatementCoverage | undefined)[]
    >();

    const discoverTests = async (tests: Iterable<vscode.TestItem>) => {
      for (const test of tests) {
        if (request.exclude?.includes(test)) {
          continue;
        }

        const data = testData.get(test);
        if (data instanceof TestCase) {
          run.enqueued(test);
          run.started(test);
          await data.run(test, run);
          run.appendOutput(`Completed ${test.id}\r\n`);
        } else if (data instanceof TestFile) {
          if (!data.didResolve) {
            await data.updateFromDisk(this.ctrl, test);
          }

          // Run all tests for this file at once
          run.enqueued(test);
          run.started(test);
          await data.run(test, run, this.ctrl);
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
      .then(() => run.end())
      .catch((error) => {
        logger.error('Error running tests:', error);
        run.end();
      });
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
