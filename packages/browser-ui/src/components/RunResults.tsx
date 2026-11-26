import type { ScreenshotComparison } from '@rstest/browser/protocol';
import { ChevronLeft, ChevronRight, Clock3, ListChecks } from 'lucide-react';
import type { TestFileInfo, TestSelection } from '../types';
import { toRelativePath } from '../utils';
import {
  CASE_STATUS_META,
  type CaseInfo,
  type CaseStatus,
  type FileState,
} from '../utils/constants';
import { FailureDetails } from './FailureDetails';
import type { StatusCounts } from './StatusGrid';

const statusColor: Record<CaseStatus, string> = {
  failed: 'text-(--ds-red-900)',
  passed: 'text-(--ds-green-900)',
  running: 'text-(--ds-amber-900)',
  skipped: 'text-(--muted-foreground)',
  idle: 'text-(--muted-foreground)',
};

function ResultStatus({ status }: { status: CaseStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 capitalize ${statusColor[status]}`}
    >
      {CASE_STATUS_META[status].icon}
      {status}
    </span>
  );
}

const formatDuration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;

export function RunResults({
  testFiles,
  rootPath,
  fileStates,
  caseMap,
  counts,
  file,
  selectedCase,
  comparisons,
  onSelect,
}: {
  testFiles: TestFileInfo[];
  rootPath: string;
  fileStates: Record<string, FileState>;
  caseMap: Record<string, Record<string, CaseInfo>>;
  counts: StatusCounts;
  file?: string;
  selectedCase?: CaseInfo;
  comparisons?: ReadonlyMap<string, ScreenshotComparison>;
  onSelect: (selection: TestSelection | null) => void;
}) {
  const tests = file ? Object.values(caseMap[file] ?? {}) : [];
  const rows = file
    ? tests.map((test) => ({
        key: test.id,
        selection: { file, caseId: test.id },
        label: [...test.parentNames, test.name].join(' › '),
        status: test.status,
        duration: test.duration,
      }))
    : testFiles.map(({ testPath }) => ({
        key: testPath,
        selection: { file: testPath },
        label: toRelativePath(testPath, rootPath),
        status: fileStates[testPath]?.status ?? 'idle',
        duration: undefined,
      }));
  const title =
    selectedCase?.name ??
    (file ? toRelativePath(file, rootPath) : 'Run results');

  return (
    <section
      aria-label="Test results"
      data-testid="run-results"
      className="min-h-0 flex-1 overflow-auto bg-(--background) text-(--foreground)"
    >
      <div className="mx-auto w-full max-w-5xl p-5 sm:p-8">
        {file && (
          <button
            type="button"
            data-testid="results-back"
            onClick={() => onSelect(selectedCase ? { file } : null)}
            className="mb-5 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-[inherit] text-xs text-(--muted-foreground) hover:text-(--foreground)"
          >
            <ChevronLeft size={14} />{' '}
            {selectedCase ? 'File results' : 'Run results'}
          </button>
        )}
        {selectedCase?.parentNames.length ? (
          <div className="mb-1 text-xs font-medium text-(--accents-6)">
            {selectedCase.parentNames.join(' › ')}
          </div>
        ) : null}
        <h1 className="m-0 wrap-anywhere text-2xl leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        <div className="mt-3 mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--accents-6)">
          {selectedCase ? (
            <>
              <ResultStatus status={selectedCase.status} />
              {selectedCase.duration !== undefined && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={13} /> {formatDuration(selectedCase.duration)}
                </span>
              )}
              {selectedCase.location && file && (
                <span className="font-mono">
                  {toRelativePath(selectedCase.location.file || file, rootPath)}
                  :{selectedCase.location.line}
                </span>
              )}
            </>
          ) : file ? (
            <>
              <ResultStatus status={fileStates[file]?.status ?? 'idle'} />
              <span>
                {tests.length} {tests.length === 1 ? 'test' : 'tests'}
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <ListChecks size={14} />
                {testFiles.length} {testFiles.length === 1 ? 'file' : 'files'}
              </span>
              {(['passed', 'failed', 'skipped', 'running', 'idle'] as const)
                .filter((status) => counts[status] > 0)
                .map((status) => (
                  <span key={status} className={statusColor[status]}>
                    {counts[status]} {status}
                  </span>
                ))}
            </>
          )}
        </div>
        {file && (
          <FailureDetails
            comparisons={comparisons}
            fileErrors={selectedCase ? undefined : fileStates[file]?.errors}
            cases={selectedCase ? [selectedCase] : tests}
            selectedCase={selectedCase}
          />
        )}
        {!selectedCase && (
          <>
            <h2 className="mb-2 text-sm font-semibold">
              {file ? 'Tests' : 'Test files'}
            </h2>
            <div className="divide-x-0 divide-y divide-solid divide-(--border) overflow-hidden rounded-lg border border-solid border-(--border)">
              {rows.length ? (
                rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    data-testid="result-row"
                    onClick={() => onSelect(row.selection)}
                    className="flex w-full cursor-pointer items-center gap-3 border-0 bg-(--muted) px-4 py-3 text-left font-[inherit] text-xs text-(--foreground) hover:bg-(--accents-2)"
                  >
                    <span className="min-w-0 flex-1 wrap-anywhere">
                      {row.label}
                    </span>
                    {row.duration !== undefined && (
                      <span className="text-(--muted-foreground)">
                        {formatDuration(row.duration)}
                      </span>
                    )}
                    <ResultStatus status={row.status} />
                    <ChevronRight
                      size={14}
                      className="text-(--muted-foreground)"
                    />
                  </button>
                ))
              ) : (
                <p className="m-0 px-4 py-3 text-sm text-(--muted-foreground)">
                  {file ? 'No test cases reported' : 'No test files reported'}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
