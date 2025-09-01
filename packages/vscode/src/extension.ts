import vscode from 'vscode';
import { logger } from './logger';
import { RstestApi } from './master';
import {
  gatherTestItems,
  getContentFromFilesystem,
  scanAllTestFiles,
  TestCase,
  TestFile,
  testData,
} from './testTree';
import { getWorkspaceTestPatterns, shouldIgnorePath } from './utils';

export async function activate(context: vscode.ExtensionContext) {
  const rstest = new Rstest(context);
  return rstest;
}

class Rstest {
  private context: vscode.ExtensionContext;
  private ctrl: vscode.TestController;
  private fileChangedEmitter: vscode.EventEmitter<vscode.Uri>;
  private watchingTests: Map<
    vscode.TestItem | 'ALL',
    vscode.TestRunProfile | undefined
  >;
  private api: RstestApi;

  // Add getter to access the test controller for testing
  get testController() {
    return this.ctrl;
  }

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.ctrl = vscode.tests.createTestController('rstest', 'Rstest');
    context.subscriptions.push(this.ctrl, logger);

    this.fileChangedEmitter = new vscode.EventEmitter<vscode.Uri>();
    this.watchingTests = new Map<
      vscode.TestItem | 'ALL',
      vscode.TestRunProfile | undefined
    >();

    this.setupEventHandlers(context);
    this.setupTestController();
    this.api = new RstestApi();
    this.api.createChildProcess();

    scanAllTestFiles(this.ctrl);
  }

  private setupEventHandlers(context: vscode.ExtensionContext) {
    this.fileChangedEmitter.event((uri) => {
      if (this.watchingTests.has('ALL')) {
        this.startTestRun(
          new vscode.TestRunRequest(
            undefined,
            undefined,
            this.watchingTests.get('ALL'),
            true,
          ),
        );
        return;
      }

      const include: vscode.TestItem[] = [];
      let profile: vscode.TestRunProfile | undefined;
      for (const [item, thisProfile] of this.watchingTests) {
        const cast = item as vscode.TestItem;
        if (cast.uri?.toString() === uri.toString()) {
          include.push(cast);
          profile = thisProfile;
        }
      }

      if (include.length) {
        this.startTestRun(
          new vscode.TestRunRequest(include, undefined, profile, true),
        );
      }
    });

    for (const document of vscode.workspace.textDocuments) {
      this.updateNodeForDocument(document);
    }

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) =>
        this.updateNodeForDocument(document),
      ),
      vscode.workspace.onDidChangeTextDocument((e) =>
        this.updateNodeForDocument(e.document),
      ),
      vscode.workspace.onDidDeleteFiles((e) => {
        for (const uri of e.files) {
          this.ctrl.items.delete(uri.toString());
        }
      }),
    );
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

    this.ctrl.refreshHandler = async () => {
      await Promise.all(
        getWorkspaceTestPatterns().map(({ pattern }) => {
          return findInitialFiles(this.ctrl, pattern);
        }),
      );
    };

    const _runProfile = this.ctrl.createRunProfile(
      'Run Tests',
      vscode.TestRunProfileKind.Run,
      runHandler,
      true,
      undefined,
      true,
    );

    const coverageProfile = this.ctrl.createRunProfile(
      'Run with Coverage',
      vscode.TestRunProfileKind.Coverage,
      runHandler,
      true,
      undefined,
      true,
    );

    coverageProfile.loadDetailedCoverage = async (_testRun, coverage) => {
      if (coverage instanceof RstestFileCoverage) {
        return coverage.coveredLines.filter(
          (l): l is vscode.StatementCoverage => !!l,
        );
      }

      return [];
    };

    this.ctrl.resolveHandler = async (item) => {
      if (!item) {
        // this.initialize(this.context);
        this.context.subscriptions.push(
          ...startWatchingWorkspace(this.ctrl, this.fileChangedEmitter),
        );
        // Ensure all test files are discovered and parsed at startup
        // await scanAllTestFiles(this.ctrl);
        return;
      }

      const data = testData.get(item);
      if (data instanceof TestFile) {
        await data.updateFromDisk(this.ctrl, item);
      }
    };
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
          await data.run(test, run, this.api);
          run.appendOutput(`Completed ${test.id}\r\n`);
        } else if (data instanceof TestFile) {
          if (!data.didResolve) {
            await data.updateFromDisk(this.ctrl, test);
          }

          // Run all tests for this file at once
          run.enqueued(test);
          run.started(test);
          await data.run(test, run, this.api, this.ctrl);
        } else {
          // Process child tests
          await discoverTests(gatherTestItems(test.children));
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

    // const runTestQueue = async () => {
    //   for (const { test, data } of queue) {
    //     run.appendOutput(`Running ${test.id}\r\n`);
    //     if (run.token.isCancellationRequested) {
    //       run.skipped(test);
    //     } else {
    //       run.started(test);
    //       await data.run(test, run, this.api);
    //     }

    //     const lineNo = test.range!.start.line;
    //     const fileCoverage = coveredLines.get(test.uri!.toString());
    //     const lineInfo = fileCoverage?.[lineNo];
    //     if (lineInfo) {
    //       (lineInfo.executed as number)++;
    //     }

    //     run.appendOutput(`Completed ${test.id}\r\n`);
    //   }

    //   // TODO: support coverage in the future
    //   // for (const [uri, statements] of coveredLines) {
    //   //   run.addCoverage(new MarkdownFileCoverage(uri, statements));
    //   // }

    //   run.end();
    // };

    discoverTests(request.include ?? gatherTestItems(this.ctrl.items))
      .then(() => run.end())
      .catch((error) => {
        logger.error('Error running tests:', error);
        run.end();
      });
  };

  private updateNodeForDocument(e: vscode.TextDocument) {
    if (e.uri.scheme !== 'file') {
      return;
    }

    if (isTestFilePath(e.uri)) {
      const { file, data } = getOrCreateFile(this.ctrl, e.uri);
      data.updateFromContents(this.ctrl, e.getText(), file);
    }

    return;
  }

  // async initialize(context: vscode.ExtensionContext) {
  //   context.subscriptions.push(
  //     ...startWatchingWorkspace(this.ctrl, this.fileChangedEmitter),
  //   );
  // }
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) {
  const existing = controller.items.get(uri.toString());
  if (existing) {
    return { file: existing, data: testData.get(existing) as TestFile };
  }

  const file = controller.createTestItem(
    uri.toString(),
    uri.path.split('/').pop()!,
    uri,
  );
  controller.items.add(file);

  const data = new TestFile();
  testData.set(file, data);

  file.canResolveChildren = true;
  return { file, data };
}

// gatherTestItems is provided by testTree.ts

async function findInitialFiles(
  controller: vscode.TestController,
  pattern: vscode.GlobPattern,
) {
  for (const file of await vscode.workspace.findFiles(pattern)) {
    const path = file.fsPath.toString();
    const shouldIgnore = shouldIgnorePath(path);
    if (!shouldIgnore) {
      getOrCreateFile(controller, file);
    }
  }
}

function startWatchingWorkspace(
  controller: vscode.TestController,
  fileChangedEmitter: vscode.EventEmitter<vscode.Uri>,
) {
  return getWorkspaceTestPatterns().map(({ pattern }) => {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    watcher.onDidCreate((uri) => {
      getOrCreateFile(controller, uri);
      fileChangedEmitter.fire(uri);
    });

    watcher.onDidChange(async (uri) => {
      const { file, data } = getOrCreateFile(controller, uri);
      if (data.didResolve) {
        await data.updateFromDisk(controller, file);
      }
      fileChangedEmitter.fire(uri);
    });

    watcher.onDidDelete((uri) => {
      controller.items.delete(uri.toString());
    });

    findInitialFiles(controller, pattern);

    return watcher;
  });
}

function isTestFilePath(uri: vscode.Uri): boolean {
  const filename = uri.path.split('/').pop() || uri.path;
  return filename.includes('.test.') || filename.includes('.spec.');
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
