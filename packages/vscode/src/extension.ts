import * as vscode from 'vscode';
import { RstestApi } from './master';
import {
  getContentFromFilesystem,
  TestCase,
  TestFile,
  TestMdCase,
  testData,
} from './testTree';

export async function activate(context: vscode.ExtensionContext) {
  const rstest = new Rstest(context);
  await rstest.initialize(context);
}

class Rstest {
  private ctrl: vscode.TestController;
  private fileChangedEmitter: vscode.EventEmitter<vscode.Uri>;
  private watchingTests: Map<
    vscode.TestItem | 'ALL',
    vscode.TestRunProfile | undefined
  >;
  private api: RstestApi;

  constructor(context: vscode.ExtensionContext) {
    this.ctrl = vscode.tests.createTestController(
      'mathTestController',
      'Markdown Math',
    );
    context.subscriptions.push(this.ctrl);

    this.fileChangedEmitter = new vscode.EventEmitter<vscode.Uri>();
    this.watchingTests = new Map<
      vscode.TestItem | 'ALL',
      vscode.TestRunProfile | undefined
    >();

    this.setupEventHandlers(context);
    this.setupTestController();
    this.api = new RstestApi();
    this.api.createChildProcess();
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
      cancellation: vscode.CancellationToken,
    ) => {
      if (!request.continuous) {
        return this.startTestRun(request);
      }

      if (request.include === undefined) {
        this.watchingTests.set('ALL', request.profile);
        cancellation.onCancellationRequested(() =>
          this.watchingTests.delete('ALL'),
        );
      } else {
        request.include.forEach((item) => {
          this.watchingTests.set(item, request.profile);
        });
        cancellation.onCancellationRequested(() =>
          request.include!.forEach((item) => {
            this.watchingTests.delete(item);
          }),
        );
      }
    };

    this.ctrl.refreshHandler = async () => {
      await Promise.all(
        getWorkspaceTestPatterns().map(({ pattern }) =>
          findInitialFiles(this.ctrl, pattern),
        ),
      );
    };

    this.ctrl.createRunProfile(
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
      if (coverage instanceof MarkdownFileCoverage) {
        return coverage.coveredLines.filter(
          (l): l is vscode.StatementCoverage => !!l,
        );
      }

      return [];
    };

    this.ctrl.resolveHandler = async (item) => {
      if (!item) {
        return;
      }

      const data = testData.get(item);
      if (data instanceof TestFile) {
        await data.updateFromDisk(this.ctrl, item);
      }
    };
  }

  private startTestRun = (request: vscode.TestRunRequest) => {
    const queue: { test: vscode.TestItem; data: TestMdCase | TestCase }[] = [];
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
        if (data instanceof TestMdCase) {
          run.enqueued(test);
          queue.push({ test, data });
        } else if (data instanceof TestCase) {
          run.enqueued(test);
          queue.push({ test, data });
        } else {
          if (data instanceof TestFile && !data.didResolve) {
            await data.updateFromDisk(this.ctrl, test);
          }

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

    const runTestQueue = async () => {
      for (const { test, data } of queue) {
        run.appendOutput(`Running ${test.id}\r\n`);
        if (run.token.isCancellationRequested) {
          run.skipped(test);
        } else {
          run.started(test);
          await data.run(test, run, this.api);
        }

        const lineNo = test.range!.start.line;
        const fileCoverage = coveredLines.get(test.uri!.toString());
        const lineInfo = fileCoverage?.[lineNo];
        if (lineInfo) {
          (lineInfo.executed as number)++;
        }

        run.appendOutput(`Completed ${test.id}\r\n`);
      }

      // TODO: support coverage in the future
      // for (const [uri, statements] of coveredLines) {
      //   run.addCoverage(new MarkdownFileCoverage(uri, statements));
      // }

      run.end();
    };

    discoverTests(request.include ?? gatherTestItems(this.ctrl.items)).then(
      runTestQueue,
    );
  };

  private updateNodeForDocument(e: vscode.TextDocument) {
    if (e.uri.scheme !== 'file') {
      return;
    }

    if (e.uri.path.endsWith('.md') || e.uri.path.endsWith('.ts')) {
      const { file, data } = getOrCreateFile(this.ctrl, e.uri);
      data.updateFromContents(this.ctrl, e.getText(), file);
    }

    return;
  }

  async initialize(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      ...startWatchingWorkspace(this.ctrl, this.fileChangedEmitter),
    );
  }
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

function gatherTestItems(collection: vscode.TestItemCollection) {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => {
    items.push(item);
  });
  return items;
}

function getWorkspaceTestPatterns() {
  if (!vscode.workspace.workspaceFolders) {
    return [];
  }

  return vscode.workspace.workspaceFolders.map((workspaceFolder) => ({
    workspaceFolder,
    pattern: new vscode.RelativePattern(workspaceFolder, '**/*.{md|ts}'),
  }));
}

async function findInitialFiles(
  controller: vscode.TestController,
  pattern: vscode.GlobPattern,
) {
  for (const file of await vscode.workspace.findFiles(pattern)) {
    getOrCreateFile(controller, file);
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

class MarkdownFileCoverage extends vscode.FileCoverage {
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
