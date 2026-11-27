import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'pathe';
import type {
  BuiltinReporterOptions,
  DotReporterOptions,
  GithubActionsReporterOptions,
  JUnitReporterOptions,
} from '../src/types';
import { withTempDir } from './helpers/tempDir';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const coreDir = resolve(repoRoot, 'packages/core');
const tscBin = resolve(repoRoot, 'node_modules/typescript/bin/tsc');

const linkPackage = (tmpDir: string, pkgName: string, target: string): void => {
  const linkPath = join(tmpDir, 'node_modules', pkgName);
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath, 'junction');
};

const emitDeclarations = (source: string): Promise<void> =>
  withTempDir('rstest-core-dts-', (tmpDir) => {
    linkPackage(tmpDir, '@rstest/core', coreDir);
    for (const pkg of ['@rsbuild/core', '@types/chai', '@types/node', 'chai']) {
      const target = [coreDir, repoRoot]
        .map((root) => join(root, 'node_modules', pkg))
        .find((candidate) => existsSync(candidate));
      if (target) {
        linkPackage(tmpDir, pkg, target);
      }
    }

    writeFileSync(join(tmpDir, 'index.ts'), source);
    writeFileSync(
      join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: './out',
          skipLibCheck: true,
          types: ['node'],
        },
        include: ['index.ts'],
      }),
    );

    const result = spawnSync(
      process.execPath,
      [tscBin, '--project', join(tmpDir, 'tsconfig.json')],
      {
        encoding: 'utf-8',
      },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

describe('public types and built-in reporter options', () => {
  it('types JUnit, Dot, and GitHub Actions built-in reporter options consistently', () => {
    const junitValid: BuiltinReporterOptions['junit'] = {
      outputPath: './junit.xml',
    };
    const junitTyped: JUnitReporterOptions = junitValid;
    const dotTyped: DotReporterOptions = { summary: false };
    const ghTyped: GithubActionsReporterOptions = {
      annotations: true,
      summary: { maxCharsPerField: 500 },
    };

    const junitInvalid: BuiltinReporterOptions['junit'] = {
      // @ts-expect-error junit reporter only accepts outputPath
      outputFile: './junit.xml',
    };

    expect(junitTyped.outputPath).toBe('./junit.xml');
    expect(dotTyped.summary).toBe(false);
    expect(ghTyped.annotations).toBe(true);
    expect(junitInvalid).toBeDefined();
  });

  it('emits declarations cleanly for @rstest/core public APIs under declaration + strict', async () => {
    await emitDeclarations(`
      import {
        beforeAll,
        defineConfig,
        defineInlineProject,
        describe,
        expect,
        rs,
        test,
        type FakeTimerInstallOpts,
        type Fixtures,
        type InlineProjectConfig,
        type MatcherState,
        type Mock,
        type MockContext,
        type MockInstance,
        type MockResult,
        type MockSettledResult,
        type RstestConfig,
        type SuiteContext,
      } from '@rstest/core';

      type JUnitReporterTuple = Extract<
        Extract<RstestConfig['reporters'], unknown[]>[number],
        ['junit', unknown]
      >;
      export const validJUnitTuple: JUnitReporterTuple = [
        'junit',
        { outputPath: './junit.xml' },
      ];
      export const invalidJUnitTuple: JUnitReporterTuple = [
        'junit',
        {
          // @ts-expect-error built-in junit tuple only accepts outputPath
          outputFile: './junit.xml',
        },
      ];
      export const config = defineConfig({
        reporters: [
          ['junit', { outputPath: './junit.xml' }],
          ['./custom-reporter.js', { customOption: 42 }],
        ],
      });
      export const poll = () => expect.poll(() => 1);
      export const negativePoll = () => expect.poll(() => 1).not;
      export const resolves = () => expect(Promise.resolve(1)).resolves;
      export const negativeResolves = () =>
        expect(Promise.resolve(1)).resolves.not;
      export const rejects = () => expect(Promise.reject(new Error())).rejects;
      export const negativeRejects = () =>
        expect(Promise.reject(new Error())).rejects.not;
      export const project: InlineProjectConfig = defineInlineProject({
        name: 'unit',
      });
      export function captureSuiteContext() {
        let saved: Parameters<Parameters<typeof beforeAll>[0]>[0] | undefined;
        beforeAll((ctx) => {
          saved = ctx;
        });
        return saved;
      }
      export const acceptSuiteContext = (ctx: SuiteContext): SuiteContext =>
        ctx;
      export function makeFakeTimerOpts(now: number) {
        const opts: NonNullable<Parameters<typeof rs.useFakeTimers>[0]> = {
          now,
        };
        return opts;
      }
      export const explicitFakeTimerOpts: FakeTimerInstallOpts = { now: 0 };
      export function getMockContext(mock: MockInstance) {
        return mock.mock;
      }
      export function getMockResults(
        mock: Mock<(a: number) => Promise<string>>,
      ) {
        const ctx: MockContext<(a: number) => Promise<string>> = mock.mock;
        const results: MockResult<Promise<string>>[] = ctx.results;
        const settled: MockSettledResult<string>[] = ctx.settledResults;
        return { ctx, results, settled };
      }
      export function getMatcherState() {
        return expect.getState();
      }
      export const acceptMatcherState = (state: MatcherState): MatcherState =>
        state;
      export function makeHelperOptions() {
        const pollOpts: NonNullable<Parameters<typeof expect.poll>[1]> = {
          timeout: 1000,
          message: 'ready',
        };
        const waitForOpts: Extract<Parameters<typeof rs.waitFor>[1], object> = {
          timeout: 1000,
        };
        const waitUntilOpts: Extract<
          Parameters<typeof rs.waitUntil>[1],
          object
        > = { interval: 50 };
        const mockObjOpts: NonNullable<Parameters<typeof rs.mockObject>[1]> = {
          spy: true,
        };
        return { pollOpts, waitForOpts, waitUntilOpts, mockObjOpts };
      }
      export const testEach = test.each;
      export const describeEach = describe.each;
      export const describeFor = describe.for;
      export function getFixtureEntry<T extends { count: number }>(
        fixtures: Fixtures<T>,
      ) {
        return fixtures.count;
      }
    `);
  });

  it('emits declarations cleanly for @rstest/core/api under declaration + strict', async () => {
    await emitDeclarations(`
      import {
        createRstest,
        ListTestsError,
        type Reporter,
        type SerializedError,
      } from '@rstest/core/api';

      export function getListedFiles(error: ListTestsError) {
        return error.files;
      }
      export function getUnhandledErrors(
        error: ListTestsError,
      ): SerializedError[] {
        return error.unhandledErrors;
      }
      export async function getRunUnhandledErrors() {
        const instance = await createRstest();
        const result = await instance.run();
        return result.unhandledErrors;
      }
      export async function getConfiguredReporters() {
        const instance = await createRstest();
        return instance.context.config.reporters;
      }
      export const noopReporter: Reporter = {};
    `);
  });
});
