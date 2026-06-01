import type { TraceEvent } from '../../src/utils/trace';
import {
  formatTraceSummary,
  summarizeTrace,
} from '../../src/utils/traceSummary';

const ROOT = '/repo';

// Durations are authored in milliseconds for readability and converted to the
// microsecond units the trace format uses.
const slice = (
  name: string,
  cat: string,
  durMs: number,
  testPath: string,
  tid = 1,
): TraceEvent => ({
  name,
  cat,
  ph: 'X',
  ts: 0,
  dur: durMs * 1000,
  pid: 1,
  tid,
  args: { testPath, project: 'default' },
});

it('aggregates phases by name across files and ranks them', () => {
  const events: TraceEvent[] = [
    slice('load', 'phase', 100, 'src/a.test.ts', 1),
    slice('tests', 'phase', 300, 'src/a.test.ts', 1),
    slice('load', 'phase', 100, 'src/b.test.ts', 2),
    slice('tests', 'phase', 100, 'src/b.test.ts', 2),
  ];

  const { phases, fileCount } = summarizeTrace(events, ROOT);

  expect(fileCount).toBe(2);
  // tests = 400ms total, load = 200ms total; ranked desc.
  expect(phases.map((p) => p.name)).toEqual(['tests', 'load']);
  expect(phases[0]).toMatchObject({ totalUs: 400_000, count: 2 });
  // 400 / 600 total phase time.
  expect(phases[0].pct).toBeCloseTo(66.6667, 2);
  expect(phases[1]).toMatchObject({ name: 'load', totalUs: 200_000 });
});

it('ranks files by summed phase wall time, relative to repo root', () => {
  const events: TraceEvent[] = [
    slice('load', 'phase', 100, 'src/a.test.ts', 1),
    slice('tests', 'phase', 300, 'src/a.test.ts', 1),
    slice('load', 'phase', 50, 'src/b.test.ts', 2),
  ];

  const { files } = summarizeTrace(events, ROOT);

  expect(files).toEqual([
    { path: 'src/a.test.ts', totalUs: 400_000, pct: 88.88888888888889 },
    { path: 'src/b.test.ts', totalUs: 50_000, pct: 11.11111111111111 },
  ]);
});

it('collects host spans and slowest cases separately from phases', () => {
  const events: TraceEvent[] = [
    slice('host:get-rsbuild-stats', 'host', 500, '<project>'),
    slice('load', 'phase', 100, 'src/a.test.ts'),
    slice('fast case', 'case', 5, 'src/a.test.ts'),
    slice('slow case', 'case', 80, 'src/a.test.ts'),
  ];

  const { host, cases } = summarizeTrace(events, ROOT);

  expect(host).toEqual([
    {
      name: 'host:get-rsbuild-stats',
      totalUs: 500_000,
      count: 1,
      pct: 100,
    },
  ]);
  expect(cases.map((c) => c.name)).toEqual(['slow case', 'fast case']);
  expect(cases[0]).toEqual({
    name: 'slow case',
    path: 'src/a.test.ts',
    durUs: 80_000,
  });
});

it('ignores counter/metadata events and slices without a duration', () => {
  const events: TraceEvent[] = [
    slice('tests', 'phase', 100, 'src/a.test.ts'),
    { name: 'heap', cat: 'memory', ph: 'C', ts: 0, pid: 1, tid: 1 },
    { name: 'process_name', cat: '__metadata', ph: 'M', ts: 0, pid: 1, tid: 1 },
  ];

  const { phases, fileCount } = summarizeTrace(events, ROOT);

  expect(phases).toHaveLength(1);
  expect(fileCount).toBe(1);
});

it('formats markdown, omits empty sections, and truncates long tables', () => {
  const events: TraceEvent[] = [
    slice('tests', 'phase', 300, 'src/a.test.ts', 1),
    slice('load', 'phase', 100, 'src/a.test.ts', 1),
    ...Array.from({ length: 12 }, (_, i) =>
      slice(`case ${i}`, 'case', 12 - i, 'src/a.test.ts'),
    ),
  ];

  const md = formatTraceSummary(summarizeTrace(events, ROOT), { topCases: 10 });

  expect(md).toContain('# Trace summary — 1 test file(s)');
  // Title is followed by a blank line before the first section.
  expect(md).toContain(
    '# Trace summary — 1 test file(s)\n\n## Phases (aggregate across workers)\n\n|',
  );
  expect(md).toContain('| tests | 300.0ms | 75.0% | 1     |');
  // No host spans in this trace → host section omitted.
  expect(md).not.toContain('## Host spans');
  // 12 cases, capped at 10.
  expect(md).toContain('## Slowest test cases');
  expect(md).toContain('… and 2 more case(s)');
});
