import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Profiler } from 'node:inspector';
import { rspack } from '@rsbuild/core';
import { decodedMappings, TraceMap } from '@jridgewell/trace-mapping';
import libCoverage from 'istanbul-lib-coverage';
import { parse } from 'yuku-parser';
import {
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

async function collect(
  code: string,
  url: string,
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
          const context = vm.createContext({ make: value => value });
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
        workerData: { code, url },
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
  form: 'es2022' | 'es2016' | 'es5' | 'reordered',
) {
  const file = join(tmpdir(), 'rstest-converter', `${name}.ts`);
  const generated = join(tmpdir(), 'rstest-converter', `${name}-${form}.js`);
  const result = await rspack.experiments.swc.transform(source, {
    filename: file,
    inlineSourcesContent: true,
    jsc: {
      parser: { syntax: 'typescript' },
      target: form === 'reordered' ? 'es2022' : form,
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
      ast: parse(code, { sourceType: 'module', preserveParens: false }),
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
        ast: parse(code, { sourceType: 'module', preserveParens: false }),
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
        ast: parse(code, { sourceType: 'module', preserveParens: false }),
        cacheKey: file,
        code,
        coverage: await collect(code, pathToFileURL(file).href),
      });
      expect(coverage[file]!.statementMap).toEqual({});
    },
  );
});
