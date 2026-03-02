import * as vscode from 'vscode';

export type DiagnosticEntry = {
  uri: vscode.Uri;
  diagnostic: vscode.Diagnostic;
};

export class RstestDiagnostics implements vscode.Disposable {
  private readonly collection =
    vscode.languages.createDiagnosticCollection('rstest');

  private readonly diagnosticsByProject = new Map<
    string,
    Map<vscode.TestItem, DiagnosticEntry[]>
  >();

  public setForTest(
    projectKey: string,
    testItem: vscode.TestItem,
    diagnostics: DiagnosticEntry[],
  ) {
    if (!projectKey) {
      return;
    }
    if (diagnostics.length === 0) {
      this.clearForTest(projectKey, testItem);
      return;
    }

    let projectDiagnostics = this.diagnosticsByProject.get(projectKey);
    if (!projectDiagnostics) {
      projectDiagnostics = new Map<vscode.TestItem, DiagnosticEntry[]>();
      this.diagnosticsByProject.set(projectKey, projectDiagnostics);
    }

    projectDiagnostics.set(testItem, diagnostics);
    this.flush();
  }

  public clearForTest(projectKey: string, testItem: vscode.TestItem) {
    const projectDiagnostics = this.diagnosticsByProject.get(projectKey);
    if (!projectDiagnostics) {
      return;
    }

    if (projectDiagnostics.delete(testItem)) {
      if (projectDiagnostics.size === 0) {
        this.diagnosticsByProject.delete(projectKey);
      }
      this.flush();
    }
  }

  public clearForProject(projectKey: string) {
    if (!projectKey) {
      return;
    }

    if (this.diagnosticsByProject.delete(projectKey)) {
      this.flush();
    }
  }

  public clear() {
    this.diagnosticsByProject.clear();
    this.collection.clear();
  }

  private flush() {
    const diagnosticsByFile = new Map<
      string,
      { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }
    >();

    for (const projectDiagnostics of this.diagnosticsByProject.values()) {
      for (const diagnostics of projectDiagnostics.values()) {
        for (const entry of diagnostics) {
          const key = entry.uri.toString();
          const fileDiagnostics = diagnosticsByFile.get(key);
          if (fileDiagnostics) {
            fileDiagnostics.diagnostics.push(entry.diagnostic);
            continue;
          }
          diagnosticsByFile.set(key, {
            uri: entry.uri,
            diagnostics: [entry.diagnostic],
          });
        }
      }
    }

    this.collection.clear();
    for (const { uri, diagnostics } of diagnosticsByFile.values()) {
      this.collection.set(uri, diagnostics);
    }
  }

  public dispose() {
    this.clear();
    this.collection.dispose();
  }
}
