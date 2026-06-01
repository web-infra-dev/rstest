import { displayPath } from './helper';
import type { TraceEvent } from './trace';

/** A `ph: 'X'` (complete) trace event with a numeric `dur`. */
type Slice = TraceEvent & { dur: number };

const isSlice = (ev: TraceEvent): ev is Slice =>
  ev.ph === 'X' && typeof ev.dur === 'number';

/**
 * Slice categories the worker `PhaseTracker` emits per test file. Everything
 * else carried on a `ph: 'X'` slice (`host:*`, `coverage:*`, and any future
 * host-side category) is a host-side span — see {@link summarizeTrace}.
 */
const WORKER_SLICE_CATS = new Set(['phase', 'suite', 'case']);

// ---------------------------------------------------------------------------
// Summary model
// ---------------------------------------------------------------------------

/** One aggregated row: slices sharing a `name`, summed. */
export interface TraceSummaryGroup {
  name: string;
  /** Sum of slice durations (microseconds). */
  totalUs: number;
  /** Number of slices folded into this row. */
  count: number;
  /** Share of this section's total (0–100). */
  pct: number;
}

/** One test file's wall time, derived from its phase slices. */
export interface TraceFileEntry {
  /** Path relative to `rootPath` when inside it, else absolute. */
  path: string;
  totalUs: number;
  pct: number;
}

/** One test case slice (a leaf in the call tree). */
export interface TraceCaseEntry {
  name: string;
  path: string;
  durUs: number;
}

export interface TraceSummary {
  /** Per-file lifecycle phases (`cat: 'phase'`), grouped by phase name. */
  phases: TraceSummaryGroup[];
  /**
   * Host-side spans (`host:*`, `coverage:*`, …, i.e. any non-worker slice
   * category — e.g. rsbuild build, coverage report generation), grouped by
   * name.
   */
  host: TraceSummaryGroup[];
  /** Per-file wall time (sum of the file's phase slices), ranked desc. */
  files: TraceFileEntry[];
  /** Individual test cases (`cat: 'case'`), ranked by duration desc. */
  cases: TraceCaseEntry[];
  /** Distinct test files observed. */
  fileCount: number;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Group `ph: 'X'` slices whose category matches `matchCat` by `name`, summing
 * durations.
 *
 * Phases and host spans are non-overlapping within their own track and are
 * aggregated across all workers, so summed durations exceed wall-clock time
 * when workers run in parallel — this mirrors the aggregate convention used by
 * other JS test runners (e.g. Vitest's `Duration ... (setup Xs, collect Ys)`
 * line). Percentages are relative to the section's own total, not wall-clock.
 */
const groupByName = (
  events: TraceEvent[],
  matchCat: (cat: string) => boolean,
): TraceSummaryGroup[] => {
  const byName = new Map<string, { totalUs: number; count: number }>();
  let total = 0;
  for (const ev of events) {
    if (!isSlice(ev) || !matchCat(ev.cat)) continue;
    const cur = byName.get(ev.name) ?? { totalUs: 0, count: 0 };
    cur.totalUs += ev.dur;
    cur.count += 1;
    byName.set(ev.name, cur);
    total += ev.dur;
  }
  return [...byName.entries()]
    .map(([name, { totalUs, count }]) => ({
      name,
      totalUs,
      count,
      pct: total === 0 ? 0 : (totalUs / total) * 100,
    }))
    .sort((a, b) => b.totalUs - a.totalUs);
};

/**
 * Reduce a flat trace event list to an agent/CI-friendly summary: which phases
 * and host spans dominated, which files were slowest, and the slowest cases.
 * Pure and dependency-free — the same data Perfetto would visualize, collapsed
 * to ranked tables instead of a flame graph.
 */
export const summarizeTrace = (
  events: TraceEvent[],
  rootPath: string,
): TraceSummary => {
  const phases = groupByName(events, (cat) => cat === 'phase');
  // Host-side spans are every other `ph: 'X'` category (`host:*`, `coverage:*`,
  // …); aggregating by exclusion keeps coverage and future host categories in
  // the summary instead of silently dropping them.
  const host = groupByName(events, (cat) => !WORKER_SLICE_CATS.has(cat));

  // Per-file wall time = sum of that file's phase slices (phases are
  // sequential and cover the file's lifetime). Keyed by the file's testPath.
  const fileUs = new Map<string, number>();
  let phaseTotal = 0;
  for (const ev of events) {
    if (!isSlice(ev) || ev.cat !== 'phase') continue;
    const testPath =
      typeof ev.args?.testPath === 'string' ? ev.args.testPath : undefined;
    if (!testPath) continue;
    fileUs.set(testPath, (fileUs.get(testPath) ?? 0) + ev.dur);
    phaseTotal += ev.dur;
  }
  const files: TraceFileEntry[] = [...fileUs.entries()]
    .map(([testPath, totalUs]) => ({
      path: displayPath(testPath, rootPath),
      totalUs,
      pct: phaseTotal === 0 ? 0 : (totalUs / phaseTotal) * 100,
    }))
    .sort((a, b) => b.totalUs - a.totalUs);

  const cases: TraceCaseEntry[] = events
    .filter((ev): ev is Slice => isSlice(ev) && ev.cat === 'case')
    .map((ev) => ({
      name: ev.name,
      path:
        typeof ev.args?.testPath === 'string'
          ? displayPath(ev.args.testPath, rootPath)
          : '',
      durUs: ev.dur,
    }))
    .sort((a, b) => b.durUs - a.durUs);

  return { phases, host, files, cases, fileCount: fileUs.size };
};

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

/** Human-readable duration from microseconds (`12.40s` / `345.0ms`). */
const fmtDur = (us: number): string => {
  const ms = us / 1000;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(2)}ms`;
};

const fmtPct = (pct: number): string => `${pct.toFixed(1)}%`;

/**
 * Render a markdown table whose columns are space-padded so the raw text also
 * lines up when printed to a terminal (still valid GitHub-flavored markdown).
 */
const mdTable = (headers: string[], rows: string[][]): string => {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(' | ')} |`;
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [line(headers), sep, ...rows.map(line)].join('\n');
};

/**
 * Cap a ranked list to its top `limit` rows, returning the rows to render plus
 * a `… and N more` note for the remainder (undefined when nothing was hidden).
 */
const truncated = <T>(
  items: T[],
  limit: number,
  noun: string,
): { shown: T[]; note?: string } => {
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  return {
    shown,
    note: rest > 0 ? `… and ${rest} more ${noun}(s)` : undefined,
  };
};

export interface FormatTraceSummaryOptions {
  /** Max rows in the slowest-files table (default 10). */
  topFiles?: number;
  /** Max rows in the slowest-cases table (default 10). */
  topCases?: number;
}

/**
 * Format a {@link TraceSummary} as markdown for stdout and the `.summary.md`
 * sidecar file. Empty sections are omitted; long tables are truncated to the
 * top-N rows with a trailing "… and N more" note so output stays compact.
 */
export const formatTraceSummary = (
  summary: TraceSummary,
  options: FormatTraceSummaryOptions = {},
): string => {
  const { topFiles = 10, topCases = 10 } = options;
  // Each block is a self-contained section (heading + blank line + table);
  // blocks are joined with a blank line so the title and every section are
  // separated by one empty line, matching standard markdown spacing.
  const blocks: string[] = [
    `# Trace summary — ${summary.fileCount} test file(s)`,
  ];

  const section = (heading: string, table: string, note?: string): void => {
    blocks.push(`${heading}\n\n${table}${note ? `\n\n${note}` : ''}`);
  };

  if (summary.phases.length) {
    section(
      '## Phases (aggregate across workers)',
      mdTable(
        ['phase', 'total', '%', 'count'],
        summary.phases.map((p) => [
          p.name,
          fmtDur(p.totalUs),
          fmtPct(p.pct),
          String(p.count),
        ]),
      ),
    );
  }

  if (summary.host.length) {
    section(
      '## Host spans',
      mdTable(
        ['span', 'total', '%', 'count'],
        summary.host.map((h) => [
          h.name,
          fmtDur(h.totalUs),
          fmtPct(h.pct),
          String(h.count),
        ]),
      ),
    );
  }

  if (summary.files.length) {
    const { shown, note } = truncated(summary.files, topFiles, 'file');
    section(
      '## Slowest files (by phase wall time)',
      mdTable(
        ['file', 'total', '%'],
        shown.map((f) => [f.path, fmtDur(f.totalUs), fmtPct(f.pct)]),
      ),
      note,
    );
  }

  if (summary.cases.length) {
    const { shown, note } = truncated(summary.cases, topCases, 'case');
    section(
      '## Slowest test cases',
      mdTable(
        ['case', 'file', 'dur'],
        shown.map((c) => [c.name, c.path, fmtDur(c.durUs)]),
      ),
      note,
    );
  }

  return blocks.join('\n\n');
};
