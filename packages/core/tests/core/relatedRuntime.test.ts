import { beforeEach, describe, expect, it, rs } from '@rstest/core';
import { normalize } from 'pathe';
import type { SetupFileState } from '../../src/core/config/setupFileState';
import { resolveRelatedTestFiles } from '../../src/core/execution/related';
import type {
  RuntimeDependencyCall,
  RuntimeDependencyRequest,
} from '../../src/core/execution/runtimeDependencies';
import type { InternalContext } from '../../src/types';

type TestModule = {
  type: string;
  nameForCondition: () => string;
  buildInfo?: {
    rstestRuntimeDependencies?: {
      version: number;
      calls: RuntimeDependencyCall[];
    };
    rstestDeclaredRuntimeDependencies?: {
      version: number;
      complete: boolean;
      files: string[];
    };
  };
  modules?: TestModule[];
};

const firstTest = '/repo/first/example.test.ts';
const secondTest = '/repo/second/example.test.ts';
const entries = [firstTest, secondTest];
let modules: TestModule[];
let statsModules: {
  nameForCondition: string;
  reasons: { moduleIdentifier: string }[];
}[];
let setupPaths: string[];
let errors: { moduleIdentifier: string }[];
let requests: RuntimeDependencyRequest[];
let selectedConsumers: Set<string>;
let warnings: string[];

rs.mock('../../src/utils', () => ({
  getTestEntries: async () =>
    Object.fromEntries(entries.map((entry) => [entry, entry])),
  normalizeExactPathMatch: (file: string) => normalize(file),
  logger: { warn: (message: string) => warnings.push(message) },
}));

rs.mock('../../src/core/execution/runtimeDependencies', () => ({
  resolveRuntimeDependencyConsumers: async (input: {
    requests: RuntimeDependencyRequest[];
  }) => {
    requests = input.requests;
    return selectedConsumers;
  },
}));

rs.mock('../../src/core/build/rsbuild', () => ({
  prepareRsbuild: async ({
    setupFileState,
  }: {
    setupFileState: SetupFileState;
  }) => {
    setupFileState.setupFiles.unit = Object.fromEntries(
      setupPaths.map((path) => [path, path]),
    );
    setupFileState.virtualModules.unit = Object.fromEntries(
      statsModules.map((module) => [module.nameForCondition, '']),
    );
    return {
      createDevServer: async () => ({
        close: async () => undefined,
        environments: {
          unit: {
            getStats: async () => ({
              hasErrors: () => errors.length > 0,
              compilation: { modules },
              toJson: () => ({ modules: statsModules, errors }),
            }),
          },
        },
      }),
    };
  },
}));

const addModule = (file: string, dependents: string[] = []): TestModule => {
  const module: TestModule = {
    type: 'javascript/esm',
    nameForCondition: () => file,
    buildInfo: { rstestRuntimeDependencies: { version: 1, calls: [] } },
  };
  modules.push(module);
  statsModules.push({
    nameForCondition: file,
    reasons: dependents.map((moduleIdentifier) => ({ moduleIdentifier })),
  });
  return module;
};

const listRelated = (file: string) => {
  // The compiler and worker are fakes; only the resolver's context fields are needed.
  const context = {
    rootPath: '/repo',
    normalizedConfig: { pool: { type: 'forks' } },
    projects: [
      {
        name: 'unit',
        environmentName: 'unit',
        rootPath: '/repo',
        outputModule: true,
        normalizedConfig: {
          root: '.',
          include: [],
          exclude: { patterns: [] },
          includeSource: [],
          env: {},
          browser: { enabled: false },
        },
      },
    ],
  } as unknown as InternalContext;
  return resolveRelatedTestFiles(context, { sourceFilters: [file] });
};

beforeEach(() => {
  modules = [];
  statsModules = [];
  setupPaths = [];
  errors = [];
  requests = [];
  selectedConsumers = new Set();
  warnings = [];
  for (const entry of entries) addModule(entry);
});

describe('native dependency graph ownership', () => {
  it('retains distinct entry origins for tests sharing a native require', async () => {
    const shared = addModule('/repo/shared.ts', entries);
    shared.buildInfo!.rstestRuntimeDependencies!.calls.push({
      kind: 'require',
      origin: 'entry',
      parts: ['./price.cjs'],
    });
    selectedConsumers.add(firstTest);

    expect(await listRelated('/repo/first/price.cjs')).toEqual([firstTest]);
    expect(requests.map(({ source, consumer }) => [source, consumer])).toEqual([
      [firstTest, firstTest],
      [secondTest, secondTest],
    ]);
  });

  it('uses the original source and outer graph owner for concatenated calls', async () => {
    const wrapper = addModule('/repo/wrapper.ts', [firstTest]);
    wrapper.modules = [
      {
        type: 'javascript/esm',
        nameForCondition: () => '/repo/nested/source.ts',
        buildInfo: {
          rstestRuntimeDependencies: {
            version: 1,
            calls: [
              { kind: 'import', origin: 'source', parts: ['./provider.mjs'] },
            ],
          },
        },
      },
    ];
    selectedConsumers.add('/repo/wrapper.ts');

    expect(await listRelated('/repo/nested/provider.mjs')).toEqual([firstTest]);
    expect(requests).toMatchObject([
      {
        source: '/repo/nested/source.ts',
        consumer: '/repo/wrapper.ts',
      },
    ]);
  });

  it('preserves whole-project fan-out from a declared setup input', async () => {
    const setup = addModule('/repo/virtual-setup.mjs');
    setupPaths.push('/repo/virtual-setup.mjs');
    setup.buildInfo = {
      rstestDeclaredRuntimeDependencies: {
        version: 1,
        complete: true,
        files: ['/repo/provider.mjs'],
      },
    };

    expect(await listRelated('/repo/provider.mjs')).toEqual(entries);
    expect(requests).toEqual([]);
  });

  it('ignores disconnected missing metadata and rejects a reachable unsupported module', async () => {
    const disconnected = addModule('/repo/disconnected.ts');
    disconnected.buildInfo = {};
    expect(await listRelated('/repo/unrelated.txt')).toEqual([]);

    const connected = addModule('/repo/connected.ts', [firstTest]);
    connected.buildInfo = {};
    await expect(listRelated('/repo/unrelated.txt')).rejects.toThrow(
      'Native dependency metadata is unavailable for /repo/connected.ts',
    );
  });

  it('preserves warning-only handling for test modules that failed to build', async () => {
    modules[0]!.buildInfo = {};
    errors.push({ moduleIdentifier: firstTest });

    expect(await listRelated('/repo/unrelated.txt')).toEqual([]);
    expect(warnings).toEqual([
      'Related test selection may be incomplete: 1 test file(s) failed to build and could not be analyzed.',
    ]);
  });
});
