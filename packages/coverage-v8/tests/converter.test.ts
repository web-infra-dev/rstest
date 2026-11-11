import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import type { Profiler } from 'node:inspector';
import { rspack } from '@rsbuild/core';
import { decodedMappings, TraceMap } from '@jridgewell/trace-mapping';
import { parseSync } from '@swc-next/parser';
import libCoverage from 'istanbul-lib-coverage';
import { createFastCoverageMap } from '../src/utils';
import {
  addScriptCoverageHits,
  convertV8CoverageWithAst,
  applyV8CoverageWithAst,
} from '../src/v8AstConverter';

const { createCoverageMap } = libCoverage;

const collision = `function run(value: { n: number } | null) {
  const n = value?.n ?? 0;
  if (n) {
    globalThis.total = n;
  }
  return n;
}
run({ n: 3 });
run(null);
`;

const reordered = `function first(value: number) {
  if (value) { globalThis.total = value; }
  return value;
}
function second(value: number) {
  if (value) { globalThis.total = value; }
  return value;
}
first(1);
first(2);
second(0);
`;

const conditionalAwait = `type Body = { code: number } | undefined;
async function loadBody(err: { status: number }): Promise<Body> {
  return { code: err.status === 400 ? 2 : 1 };
}
function isFiltered(body: Body): boolean {
  return body?.code === 2;
}
async function handle(passed: Body, err: { status: number }) {
  if (err.status === 404) {
    return 'not-found';
  }
  const body = passed ?? (await loadBody(err));
  if (!isFiltered(body)) {
    globalThis.reported += 1;
  }
  return body;
}
async function main() {
  globalThis.reported = 0;
  await handle(undefined, { status: 404 });
  for (let i = 0; i < 4; i++) await handle({ code: 1 }, { status: 500 });
  for (let i = 0; i < 6; i++) await handle(undefined, { status: 500 });
  for (let i = 0; i < 2; i++) await handle(undefined, { status: 400 });
}
globalThis.done = main();
`;

const splitAwait = `type Body = { code: number } | undefined;
async function loadBody(status: number): Promise<Body> {
  return { code: status === 400 ? 2 : 1 };
}
async function handle(passed: Body, status: number) {
  if (status === 404) {
    return 'not-found';
  }
  const body = passed ?? (await loadBody(status));
  if (status === 403) {
    return 'forbidden';
  }
  return body;
}
async function main() {
  for (const [passed, status] of globalThis.calls) {
    await handle(passed ? { code: 1 } : undefined, status);
  }
}
globalThis.done = main();
`;

async function collect(
  code: string,
  url: string,
  calls: [passed: number, status: number][] = [],
): Promise<Profiler.ScriptCoverage> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      const { Session } = require('node:inspector/promises');
      const vm = require('node:vm');
      (async () => {
        const session = new Session();
        session.connect();
        try {
          await session.post('Profiler.enable');
          await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
          const context = vm.createContext({ make: value => value, calls: workerData.calls });
          const module = new vm.SourceTextModule(workerData.code, {
            context, identifier: workerData.url,
          });
          await module.link(() => new vm.SourceTextModule('export const value = 42;', { context }));
          await module.evaluate();
          await vm.runInContext('globalThis.done', context);
          const { result } = await session.post('Profiler.takePreciseCoverage');
          parentPort.postMessage(result.find(entry => entry.url === workerData.url));
        } finally {
          session.disconnect();
        }
      })();
      `,
      {
        eval: true,
        workerData: { code, url, calls },
        execArgv: ['--experimental-vm-modules'],
      },
    );
    let coverage: Profiler.ScriptCoverage | undefined;
    worker.on('message', (value: Profiler.ScriptCoverage) => {
      coverage = value;
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code === 0 && coverage) resolve(coverage);
      else reject(new Error(`Coverage worker exited with ${code}`));
    });
  });
}

async function prepare(
  source: string,
  name: string,
  form: 'es2022' | 'es2016' | 'es5' | 'reordered' | 'minified' | 'inlined',
) {
  const file = join(tmpdir(), 'rstest-converter', `${name}.ts`);
  const generated = join(tmpdir(), 'rstest-converter', `${name}-${form}.js`);
  const result = await rspack.experiments.swc.transform(source, {
    filename: file,
    inlineSourcesContent: true,
    jsc: {
      parser: { syntax: 'typescript' },
      target:
        form === 'reordered' || form === 'minified' || form === 'inlined'
          ? 'es2022'
          : form,
      ...(form === 'minified' || form === 'inlined'
        ? {
            minify: {
              compress: {
                defaults: form === 'inlined',
                sequences: true,
                conditionals: true,
              },
              mangle: false,
            },
          }
        : {}),
    },
    sourceMaps: true,
  });
  const trace = new TraceMap(result.map!);
  let mappings = [...decodedMappings(trace)];
  let code = result.code;
  if (form === 'reordered') {
    const middle = code.indexOf('function second');
    const end = code.indexOf('\nfirst(', middle) + 1;
    const first = code.slice(0, middle);
    const second = code.slice(middle, end);
    const firstLines = first.split('\n').length - 1;
    const secondLines = second.split('\n').length - 1;
    mappings = [
      ...mappings.slice(firstLines, firstLines + secondLines),
      ...mappings.slice(0, firstLines),
      ...mappings.slice(firstLines + secondLines),
    ];
    code = second + first + code.slice(end);
  }
  const url = pathToFileURL(generated).href;
  return {
    file,
    options: {
      ast: parseSync(code, {
        sourceType: 'module',
        preserveParens: false,
      }),
      cacheKey: generated,
      code,
      coverage: await collect(code, url),
      sourceMap: {
        version: 3,
        sources: trace.sources,
        sourcesContent: trace.sourcesContent,
        names: trace.names,
        mappings,
      },
    },
  };
}

describe('coverage-v8 converter regressions', () => {
  it.each([undefined, 'export const invalid = ;'])(
    'preserves covered and uncovered counters without usable original source: %s',
    async (source) => {
      const code = 'globalThis.make(1);';
      const file = join(tmpdir(), 'rstest-converter-missing', 'original.ts');
      for (const count of [0, 2]) {
        const data = await convertV8CoverageWithAst({
          code,
          ast: parseSync(code, { sourceType: 'module', preserveParens: false }),
          cacheKey: `missing-source-${source}-${count}`,
          coverage: {
            url: pathToFileURL(`${file}.js`).href,
            functions: [
              {
                functionName: '',
                isBlockCoverage: true,
                ranges: [{ startOffset: 0, endOffset: code.length, count }],
              },
            ],
          },
          sourceMap: {
            version: 3,
            names: [],
            sources: [file],
            sourcesContent: source === undefined ? undefined : [source],
            mappings: [
              [
                [0, 0, 7, 0],
                [code.indexOf('1'), 0, 2, 0],
              ],
            ],
          },
        });
        expect(Object.values(data[file]!.s)).toEqual([count]);
        const [location] = Object.values(data[file]!.statementMap);
        expect(location!.start.line).toBe(8);
        expect(location!.end.line).toBe(8);
        expect(location!.end.column).toBeGreaterThanOrEqual(
          location!.start.column,
        );
      }
    },
  );

  it('skips parsing when all mapped sources are excluded', async () => {
    const file = join(tmpdir(), 'rstest-converter-excluded.ts');
    const code = 'globalThis.make(1), globalThis.make(2);';
    const ast = rstest.fn(() => parseSync(code, { sourceType: 'module' }));
    expect(
      await convertV8CoverageWithAst({
        code,
        ast,
        cacheKey: 'all-sources-excluded',
        coverage: { url: pathToFileURL(`${file}.js`).href, functions: [] },
        sourceMap: {
          version: 3,
          names: [],
          sources: [file],
          sourcesContent: [code],
          mappings: [[[0, 0, 0, 0]]],
        },
        sourceFilter: () => false,
      }),
    ).toEqual({});
    expect(ast).not.toHaveBeenCalled();
  });

  it('keeps included sequence children without reading an excluded source', async () => {
    const code = 'globalThis.make(1), globalThis.make(2);';
    const excluded = join(tmpdir(), 'excluded-sequence.ts');
    const included = join(tmpdir(), 'included-sequence.ts');
    const sourcesContent = ['globalThis.make(1);', 'globalThis.make(2);'];
    Object.defineProperty(sourcesContent, 0, {
      get() {
        throw new Error('Excluded source was read');
      },
    });
    const data = await convertV8CoverageWithAst({
      code,
      ast: parseSync(code, { sourceType: 'module', preserveParens: false }),
      cacheKey: 'mixed-inclusion-sequence',
      coverage: {
        url: pathToFileURL(`${included}.js`).href,
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: code.length, count: 7 }],
          },
        ],
      },
      sourceFilter: (file) => file === included,
      sourceMap: {
        version: 3,
        names: [],
        sources: [excluded, included],
        sourcesContent,
        mappings: [
          [
            [0, 0, 0, 0],
            [code.indexOf('globalThis', 1), 1, 0, 0],
          ],
        ],
      },
    });
    expect(Object.keys(data)).toEqual([included]);
    expect(Object.values(data[included]!.s)).toEqual([7]);
  });

  it('restores every statement in a large merged sequence', async () => {
    const count = 16_000;
    const source = `export function run(log: (value: number) => void) {\n${Array.from(
      { length: count },
      (_, i) => `log(${i});`,
    ).join('\n')}\n}\nrun(globalThis.make);`;
    const { file, options } = await prepare(
      source,
      'large-sequence',
      'minified',
    );
    const data = (await convertV8CoverageWithAst(options))[file]!;
    const hits = Object.entries(data.statementMap)
      .filter(([, loc]) => loc.start.line >= 2 && loc.start.line < count + 2)
      .sort(([, a], [, b]) => a.start.line - b.start.line)
      .map(([id, loc]) => [loc.start.line, data.s[id]]);
    expect(hits).toEqual(Array.from({ length: count }, (_, i) => [i + 2, 1]));
  });

  it('recovers source ranges after inlining callbacks, values and control flow', async () => {
    const source = `export function callbacks(log: (value: unknown) => void) {
  const callback = () => {
    globalThis.callbackRan = true;
  };
  log(callback);
  log('after');
}
export function value(log: (value: unknown) => void) {
  const words = ['left', 'right'];
  return log(words.join(':'));
}
export function unused(log: (value: unknown) => void) {
  const words = ['unused'];
  return log(words.join(':'));
}
export function branch(flag: boolean) {
  const fallback = 'fallback';
  if (flag) {
    return fallback;
  }
  return 'other';
}
callbacks(globalThis.make);
value(globalThis.make);
branch(true);
branch(false);
export function sameLine(log: (value: unknown) => void) { const words = ['same']; return log(words); }
sameLine(globalThis.make);
`;
    const { file, options } = await prepare(
      source,
      'inlined-ranges',
      'inlined',
    );
    const coverage = (await convertV8CoverageWithAst(options))[file]!;
    const statementsAt = (line: number) =>
      Object.entries(coverage.statementMap)
        .filter(([, location]) => location.start.line === line)
        .map(([id]) => coverage.s[id]);
    const locations = [
      ...Object.values(coverage.statementMap),
      ...Object.values(coverage.fnMap).flatMap(({ loc, decl }) => [loc, decl]),
      ...Object.values(coverage.branchMap).flatMap(({ loc, locations }) => [
        loc,
        ...locations,
      ]),
    ];
    for (const { start, end } of locations) {
      expect(end.line).toBeGreaterThanOrEqual(start.line);
      if (start.line === end.line) {
        expect(end.column).toBeGreaterThanOrEqual(start.column);
      }
    }
    expect(statementsAt(3)).toEqual([0]);
    expect(statementsAt(5)).toEqual([1]);
    expect(statementsAt(6)).toEqual([1]);
    expect(statementsAt(10)).toEqual([1]);
    expect(statementsAt(14)).toEqual([0]);
    const returned = Object.values(coverage.statementMap).find(
      ({ start }) => start.line === 10,
    );
    expect(returned?.end.line).toBe(10);

    const unminified = await prepare(source, 'inlined-ranges', 'es2022');
    const merged = createCoverageMap();
    await applyV8CoverageWithAst({ ...options, coverageMap: merged });
    await applyV8CoverageWithAst({
      ...unminified.options,
      coverageMap: merged,
    });
    const restoredReturns = Object.entries(
      merged.fileCoverageFor(file).statementMap,
    )
      .filter(([, { start }]) => start.line === 10)
      .map(([id]) => merged.fileCoverageFor(file).s[id]);
    expect(restoredReturns).toEqual([2]);
  });

  it('keeps recovered locations in the source that owns the generated start', async () => {
    const source = 'globalThis.make(1);';
    const { file, options } = await prepare(
      source,
      'cross-source-range',
      'es2022',
    );
    const coverage = await convertV8CoverageWithAst({
      ...options,
      sourceMap: {
        version: 3,
        names: [],
        sources: [file, `${file}.other.ts`],
        sourcesContent: [source, '\n\n\nother();'],
        mappings: [
          [
            [0, 0, 0, 0],
            [options.code.indexOf('1'), 1, 3, 0],
          ],
        ],
      },
    });
    expect(Object.values(coverage[file]!.statementMap)).toEqual([
      {
        start: { line: 1, column: 0 },
        end: { line: 1, column: source.length - 1 },
      },
    ]);
    expect(Object.values(coverage[file]!.s)).toEqual([1]);
  });

  it('restores statements merged by minification without splitting source comma expressions', async () => {
    const source = `function covered() {
  globalThis.first = 1;
  globalThis.second = 2;
}
function uncovered() {
  globalThis.first = 3;
  globalThis.second = 4;
}
function comma() {
  (globalThis.first = 5,
   globalThis.second = 6);
}
function sameLine() {
  globalThis.first = 7; globalThis.second = 8;
}
function mixed() {
  globalThis.first = 9;
  (globalThis.first = 10,
   globalThis.second = 11);
  globalThis.second = 12;
}
covered();
comma();
sameLine();
mixed();
`;
    const { file, options } = await prepare(
      source,
      'merged-statements',
      'minified',
    );
    const coverage = (await convertV8CoverageWithAst(options))[file]!;
    const statementsAt = (line: number) =>
      Object.entries(coverage.statementMap)
        .filter(([, location]) => location.start.line === line)
        .map(([id]) => coverage.s[id]);

    expect(statementsAt(2)).toEqual([1]);
    expect(statementsAt(3)).toEqual([1]);
    expect(statementsAt(6)).toEqual([0]);
    expect(statementsAt(7)).toEqual([0]);
    expect(statementsAt(10)).toEqual([1]);
    expect(statementsAt(11)).toEqual([]);
    expect(statementsAt(14)).toEqual([1, 1]);
    expect(statementsAt(17)).toEqual([1]);
    expect(statementsAt(18)).toEqual([1]);
    expect(statementsAt(19)).toEqual([]);
    expect(statementsAt(20)).toEqual([1]);
  });

  it('does not attribute compressed control flow to an enclosing source statement', async () => {
    const source = `globalThis.make(function (flag: boolean) {
  if (flag) globalThis.first = 1;
  globalThis.second = 2;
});
`;
    const { file, options } = await prepare(
      source,
      'merged-control-flow',
      'minified',
    );
    const coverage = (await convertV8CoverageWithAst(options))[file]!;
    const enclosing = Object.entries(coverage.statementMap).filter(
      ([, loc]) => loc.start.line === 1,
    );
    expect(enclosing).toHaveLength(1);
    expect(coverage.s[enclosing[0]![0]]).toBe(1);
  });

  it('merges minified and unminified statements without duplicating source locations', async () => {
    const source = `function run() {
  globalThis.first = 1;
  globalThis.second = 2;
  (globalThis.first = 3,
   globalThis.second = 4);
  globalThis.first = 5; globalThis.second = 6;
}
run();
`;
    const coverageMap = createCoverageMap();
    for (const form of ['es2022', 'minified'] as const) {
      const { options } = await prepare(source, 'merged-forms', form);
      await applyV8CoverageWithAst({ ...options, coverageMap });
    }
    const coverage = coverageMap.fileCoverageFor(coverageMap.files()[0]!);
    for (const line of [2, 3, 4, 6]) {
      const statements = Object.entries(coverage.statementMap).filter(
        ([, loc]) => loc.start.line === line,
      );
      expect(statements).toHaveLength(line === 6 ? 2 : 1);
      expect(statements.map(([id]) => coverage.s[id])).toEqual(
        line === 6 ? [2, 2] : [2],
      );
    }
  });

  it.each([
    { name: 'two-form', source: collision, forms: ['es2022', 'es5'] as const },
    {
      name: 'reordered',
      source: reordered,
      forms: ['es2022', 'reordered'] as const,
    },
    {
      name: 'same-form',
      source: collision,
      forms: ['es2022', 'es2022'] as const,
    },
  ])(
    'merges $name templates by source location',
    async ({ name, source, forms }) => {
      const inputs = [];
      for (const form of forms) inputs.push(await prepare(source, name, form));
      const oracle = createCoverageMap();
      for (const { options } of inputs) {
        oracle.merge(await convertV8CoverageWithAst(options));
      }
      for (const order of [inputs, [...inputs].reverse()]) {
        const actual = createCoverageMap();
        const expected = createCoverageMap();
        for (const { options } of order) {
          expected.merge(await convertV8CoverageWithAst(options));
          await applyV8CoverageWithAst({ ...options, coverageMap: actual });
        }
        expect(actual.toJSON()).toEqual(expected.toJSON());
        expect(actual.getCoverageSummary()).toEqual(
          oracle.getCoverageSummary(),
        );
        for (const file of actual.files()) {
          const data = actual.fileCoverageFor(file);
          for (const counts of [
            Object.values(data.s),
            Object.values(data.f),
            Object.values(data.b).flat(),
          ]) {
            expect(
              counts.every((count) => Number.isFinite(count) && count >= 0),
            ).toBe(true);
          }
        }
      }
    },
  );

  it.each(['es2022', 'es2016', 'es5'] as const)(
    'counts the implicit else after a conditional await (%s)',
    async (form) => {
      const { file, options } = await prepare(
        conditionalAwait,
        'conditional-await',
        form,
      );
      const coverage = (await convertV8CoverageWithAst(options))[file]!;
      const branch = Object.entries(coverage.branchMap).find(
        ([, value]) => value.type === 'if' && value.loc.start.line === 13,
      );
      expect(branch).toBeDefined();
      expect(coverage.b[branch![0]]).toEqual([10, 2]);
    },
  );

  // The implicit-else difference `addScriptCoverageHits` documents.
  it.each([
    ['es2022', [3, 0]],
    ['es2016', [3, 0]],
    ['es5', [3, 2]],
  ] as const)(
    'merges split payloads of a conditional await (%s)',
    async (form, mergedHits) => {
      const { file, options } = await prepare(splitAwait, 'split-await', form);
      const { url } = options.coverage;
      const awaited = await collect(options.code, url, [
        [0, 403],
        [0, 403],
        [0, 403],
      ]);
      const passed = await collect(options.code, url, [
        [1, 500],
        [1, 500],
      ]);
      const single = await collect(options.code, url, [
        [0, 403],
        [0, 403],
        [0, 403],
        [1, 500],
        [1, 500],
      ]);

      const separate = createFastCoverageMap();
      for (const coverage of [awaited, passed]) {
        await applyV8CoverageWithAst({
          ...options,
          coverage,
          coverageMap: separate,
        });
      }
      let ranges: Profiler.CoverageRange[] = [];
      for (const coverage of [awaited, passed]) {
        ranges = addScriptCoverageHits(ranges, coverage);
      }
      const mergedMap = createFastCoverageMap();
      await applyV8CoverageWithAst({
        ...options,
        coverage: {
          url,
          functions: [{ functionName: '', isBlockCoverage: true, ranges }],
        },
        coverageMap: mergedMap,
      });
      const merged = mergedMap.fileCoverageFor(file).data;
      const [key] = Object.entries(merged.branchMap).find(
        ([, value]) => value.type === 'if' && value.loc.start.line === 10,
      )!;
      expect(merged.b[key]).toEqual(mergedHits);
      const singleCoverage = await convertV8CoverageWithAst({
        ...options,
        coverage: single,
      });
      expect(singleCoverage[file]!.b[key]).toEqual(mergedHits);
      expect(separate.fileCoverageFor(file).data).toEqual({
        ...merged,
        b: { ...merged.b, [key]: [3, 2] },
      });
    },
  );

  it.each([
    'for (let i = 0; i < n; i++) if (take) sink();',
    'while (n-- > 0) if (take) sink();',
    'for (const item of Array(n)) if (take) sink();',
    'for (const key in Array.from({ length: n })) if (take) sink();',
    'if (n) do if (take) sink(); while (--n);',
    'if (n) if (take) sink();',
    'if (n) label: if (take) sink();',
    'for (let i = 0; i < n; i++) { if (take) sink(); }',
    'if (n) { if (take) sink(); }',
    'for (let i = 0; i < n; i++) if (take) break;',
    'for (let i = 0; i < n; i++) if (take) continue;',
    'for (let i = 0; i < n; i++) if (take) return;',
  ])(
    'keeps implicit-else counts inside their execution region: %s',
    async (body) => {
      for (const take of [false, true]) {
        const code = `function f(n, take) {
  ${body}
}
function sink() {}
for (let i = 0; i < 100; i++) f(0, ${take});
f(1, ${take});
`;
        const file = join(
          tmpdir(),
          'rstest-converter',
          `region-${createHash('sha256').update(body).digest('hex')}-${take}.js`,
        );
        const coverage = (
          await convertV8CoverageWithAst({
            ast: parseSync(code, {
              sourceType: 'module',
              preserveParens: false,
            }),
            cacheKey: file,
            code,
            coverage: await collect(code, pathToFileURL(file).href),
          })
        )[file]!;
        const branch = Object.entries(coverage.branchMap).find(
          ([, value]) =>
            value.type === 'if' &&
            value.loc.start.line === 2 &&
            value.loc.start.column === body.indexOf('if (take)') + 2,
        );
        expect(branch).toBeDefined();
        expect(coverage.b[branch![0]]).toEqual(take ? [1, 0] : [0, 1]);
      }
    },
  );

  it.each([
    'export default globalThis.make({ answer: 42 });\n',
    'export default { answer: 42 };\n',
  ])('counts executed and unexecuted default expressions: %s', async (code) => {
    const file = join(
      tmpdir(),
      'rstest-converter',
      `default-${code.includes('make') ? 'call' : 'object'}.js`,
    );
    const url = pathToFileURL(file).href;
    for (const count of [0, 1]) {
      const coverage = await convertV8CoverageWithAst({
        ast: parseSync(code, {
          sourceType: 'module',
          preserveParens: false,
        }),
        cacheKey: file,
        code,
        coverage:
          count === 1
            ? await collect(code, url)
            : {
                url,
                functions: [
                  {
                    functionName: '',
                    isBlockCoverage: true,
                    ranges: [
                      { startOffset: 0, endOffset: code.length, count: 0 },
                    ],
                  },
                ],
              },
      });
      expect(
        Object.values(coverage[file]!.statementMap).map((loc) => loc.start),
      ).toContainEqual({ line: 1, column: 15 });
      expect(Object.values(coverage[file]!.s)).toEqual([count]);
    }
  });

  it.each([
    'export default function sample() {}\n',
    'export default class Sample {}\n',
    "export { value } from './helper';\n",
  ])(
    'does not add expression statements for declarations or re-exports: %s',
    async (code) => {
      const file = join(
        tmpdir(),
        'rstest-converter',
        `${code.split(' ')[2]}.js`,
      );
      const coverage = await convertV8CoverageWithAst({
        ast: parseSync(code, {
          sourceType: 'module',
          preserveParens: false,
        }),
        cacheKey: file,
        code,
        coverage: await collect(code, pathToFileURL(file).href),
      });
      expect(coverage[file]!.statementMap).toEqual({});
    },
  );
});
