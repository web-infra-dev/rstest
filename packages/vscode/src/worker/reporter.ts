import { Writable } from 'node:stream';
import type { Reporter } from '@rstest/core';
import type {
  Context,
  ReportBase,
  ReportNode,
  Visitor,
} from 'istanbul-lib-report';
import type vscode from 'vscode';
import { masterApi } from '.';

export class ProgressReporter implements Reporter {
  onTestFileStart = masterApi.onTestFileStart.asEvent;
  onTestFileResult = masterApi.onTestFileResult.asEvent;
  onTestSuiteStart = masterApi.onTestSuiteStart.asEvent;
  onTestSuiteResult = masterApi.onTestSuiteResult.asEvent;
  onTestCaseStart = masterApi.onTestCaseStart.asEvent;
  onTestCaseResult = masterApi.onTestCaseResult.asEvent;
}

export class ProgressLogger {
  outputStream = new Writable({
    decodeStrings: false,
    write: (chunk, _encoding, cb) => {
      masterApi.onOutput.asEvent(chunk);
      cb(null);
    },
  });
  errorStream = new Writable({
    write: (_chunk, _encoding, cb) => cb(null),
  });
  getColumns = () => Number.POSITIVE_INFINITY;
}

export class CoverageReporter
  // implements ReportBase instead of extend it, to prevent bundle istanbul-lib-report into output
  implements ReportBase, Partial<Visitor<ReportNode>>
{
  // https://github.com/istanbuljs/istanbuljs/blob/28ffdbc314596bdcb3007e85d30a62372602b262/packages/istanbul-lib-report/lib/report-base.js#L11-L13
  execute(context: Context) {
    context.getTree().visit(this, context);
  }

  onDetail(root: ReportNode) {
    const summary = root.getCoverageSummary(false);
    const coverage = root.getFileCoverage();

    const details: vscode.FileCoverageDetail[] = [];

    /** map istanbul range to vscode range */
    const mapRange = (
      range: (typeof coverage.statementMap)[string],
    ): vscode.Range =>
      ({
        // TODO why line maybe zero?
        start: {
          line: (range.start.line || 1) - 1,
          character: range.start.column,
        },
        end: { line: (range.end.line || 1) - 1, character: range.end.column },
      }) as vscode.Range;

    for (const [key, branchMapping] of Object.entries(coverage.branchMap)) {
      details.push({
        executed: coverage.b[key].some(Boolean),
        location: mapRange(branchMapping.loc),
        branches: branchMapping.locations.map((location, index) => ({
          executed: coverage.b[key][index],
          location: mapRange(location),
        })),
      } satisfies vscode.StatementCoverage);
    }

    for (const [key, functionMapping] of Object.entries(coverage.fnMap)) {
      details.push({
        name: functionMapping.name,
        executed: coverage.f[key] || 0,
        location: mapRange(functionMapping.loc),
      } satisfies vscode.DeclarationCoverage);
    }

    for (const [key, statementRange] of Object.entries(coverage.statementMap)) {
      details.push({
        branches: [],
        executed: coverage.s[key] || 0,
        location: mapRange(statementRange),
      } satisfies vscode.StatementCoverage);
    }

    masterApi.onCoverage(
      coverage.path,
      summary.statements,
      summary.branches,
      summary.functions,
      details,
    );
  }
}
