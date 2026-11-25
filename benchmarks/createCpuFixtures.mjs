import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const benchmarksNodeModules = join(__dirname, 'node_modules');
const cpuFixturesRoot = join(__dirname, 'fixtures', 'cpu');

const COMPILE_WORKLOAD = {
  sharedModules: 32,
  serviceModules: 64,
  componentModules: 32,
  testFiles: 16,
};

const RUNNER_WORKLOAD = {
  suiteGroupsPerFile: 50,
  eachCasesPerSuite: 12,
};

const JSDOM_WORKLOAD = {
  componentModules: 8,
  testFiles: 16,
};

async function writeGeneratedFile(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function createPackageJson(name) {
  return JSON.stringify({ name, private: true, type: 'module' }, null, 2);
}

function createTsConfig() {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['DOM', 'ES2022'],
        module: 'ESNext',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        isolatedModules: true,
        moduleResolution: 'bundler',
      },
      include: ['src', 'tests'],
    },
    null,
    2,
  );
}

async function initProjectRoot(
  projectRoot,
  packageName,
  { withTsConfig = false } = {},
) {
  await mkdir(projectRoot, { recursive: true });
  await symlink(
    benchmarksNodeModules,
    join(projectRoot, 'node_modules'),
    'dir',
  );
  await writeGeneratedFile(
    join(projectRoot, 'package.json'),
    createPackageJson(packageName),
  );
  if (withTsConfig) {
    await writeGeneratedFile(
      join(projectRoot, 'tsconfig.json'),
      createTsConfig(),
    );
  }
}

async function createStartupFixture() {
  const root = join(cpuFixturesRoot, 'startup');
  await initProjectRoot(root, '@rstest/bench-cpu-startup');

  await writeGeneratedFile(
    join(root, 'rstest.config.mts'),
    `import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  include: ['tests/**/*.test.ts'],
  performance: { buildCache: false },
});
`,
  );

  await writeGeneratedFile(
    join(root, 'tests/smoke.test.ts'),
    `import { describe, expect, it } from '@rstest/core';

describe('startup smoke', () => {
  it('runs a minimal test', () => {
    expect(1 + 1).toBe(2);
  });
});
`,
  );

  return root;
}

async function createCompileFixture() {
  const root = join(cpuFixturesRoot, 'compile');
  await initProjectRoot(root, '@rstest/bench-cpu-compile', {
    withTsConfig: true,
  });

  await writeGeneratedFile(
    join(root, 'rstest.config.mts'),
    `import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  include: ['tests/**/*.test.tsx'],
  performance: { buildCache: false },
  pool: { type: 'forks', maxWorkers: 4 },
  tools: {
    swc: {
      jsc: {
        transform: {
          react: { runtime: 'automatic' },
        },
      },
    },
  },
});
`,
  );

  await writeGeneratedFile(
    join(root, 'src/types.ts'),
    `export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface DomainItem {
  id: string;
  domain: string;
  weight: number;
  severity: Severity;
  tags: readonly string[];
}

export interface ServiceDigest {
  serviceId: string;
  totalWeight: number;
  criticalCount: number;
  labels: string[];
}
`,
  );

  const writes = [];

  for (let i = 0; i < COMPILE_WORKLOAD.sharedModules; i += 1) {
    const prevImport =
      i > 0
        ? `import { sharedScore${i - 1} } from './shared${i - 1}.ts';\n`
        : '';
    const baseOffset = i > 0 ? `sharedScore${i - 1} % 7` : '0';
    writes.push(
      writeGeneratedFile(
        join(root, `src/shared/shared${i}.ts`),
        `${prevImport}import type { DomainItem, Severity } from '../types.ts';

const severities: readonly Severity[] = ['low', 'medium', 'high', 'critical'];

export const sharedItems${i}: readonly DomainItem[] = Array.from(
  { length: 12 },
  (_, idx) => ({
    id: 'shared-${i}-' + idx,
    domain: 'domain-${i % 8}',
    weight: (${i} + 1) * (idx + 2) + (${baseOffset}),
    severity: severities[(${i} + idx) % severities.length],
    tags: ['m${i}', 'tier-' + (idx % 3)],
  }),
);

export const sharedScore${i}: number = sharedItems${i}.reduce(
  (sum, item) => sum + item.weight,
  0,
);

export function filterShared${i}(minWeight: number): DomainItem[] {
  return sharedItems${i}.filter((item) => item.weight >= minWeight);
}
`,
      ),
    );
  }

  for (let i = 0; i < COMPILE_WORKLOAD.serviceModules; i += 1) {
    const sA = i % COMPILE_WORKLOAD.sharedModules;
    const sB = (i + 5) % COMPILE_WORKLOAD.sharedModules;
    const sC = (i + 11) % COMPILE_WORKLOAD.sharedModules;
    writes.push(
      writeGeneratedFile(
        join(root, `src/services/service${i}.ts`),
        `import { filterShared${sA}, sharedItems${sA} } from '../shared/shared${sA}.ts';
import { sharedItems${sB}, sharedScore${sB} } from '../shared/shared${sB}.ts';
import { sharedItems${sC} } from '../shared/shared${sC}.ts';
import type { DomainItem, ServiceDigest } from '../types.ts';

function mergeItems(seed: number): DomainItem[] {
  return [
    ...filterShared${sA}(seed % 10),
    ...sharedItems${sB},
    ...sharedItems${sC}.slice(0, 6),
  ];
}

export function runService${i}(seed: number): ServiceDigest {
  const items = mergeItems(seed);
  let totalWeight = sharedScore${sB} % 19;
  let criticalCount = 0;
  const labels: string[] = [];

  for (const item of items) {
    totalWeight += item.weight + seed;
    if (item.severity === 'critical') {
      criticalCount += 1;
    }
    if (labels.length < 8) {
      labels.push(\`\${item.domain}:\${item.id}:\${item.severity}\`);
    }
  }

  return {
    serviceId: 'service-${i}',
    totalWeight,
    criticalCount,
    labels,
  };
}
`,
      ),
    );
  }

  for (let i = 0; i < COMPILE_WORKLOAD.componentModules; i += 1) {
    const svcA = (i * 2) % COMPILE_WORKLOAD.serviceModules;
    const svcB = (i * 2 + 1) % COMPILE_WORKLOAD.serviceModules;
    writes.push(
      writeGeneratedFile(
        join(root, `src/components/Panel${i}.tsx`),
        `import { renderToStaticMarkup } from 'react-dom/server';
import { runService${svcA} } from '../services/service${svcA}.ts';
import { runService${svcB} } from '../services/service${svcB}.ts';
import type { ServiceDigest } from '../types.ts';

interface PanelProps {
  title: string;
  digests: readonly ServiceDigest[];
}

export function Panel${i}({ title, digests }: PanelProps) {
  return (
    <section data-panel="panel-${i}">
      <h2>{title}</h2>
      <ul>
        {digests.map((digest) => (
          <li key={digest.serviceId} data-weight={digest.totalWeight}>
            <strong>{digest.serviceId}</strong>
            <span>{digest.criticalCount}</span>
            <em>{digest.labels.join('|')}</em>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function renderPanel${i}(seed: number): {
  markup: string;
  totalWeight: number;
} {
  const digests = [runService${svcA}(seed), runService${svcB}(seed + 1)];
  const totalWeight = digests.reduce((sum, item) => sum + item.totalWeight, 0);
  const markup = renderToStaticMarkup(
    <Panel${i} title={'Panel ${i} #' + seed} digests={digests} />,
  );
  return { markup, totalWeight };
}
`,
      ),
    );
  }

  // Barrel module re-exporting all components (exercises deep barrel resolution).
  const barrelLines = Array.from(
    { length: COMPILE_WORKLOAD.componentModules },
    (_, i) =>
      `export { Panel${i}, renderPanel${i} } from './components/Panel${i}.tsx';`,
  );
  writes.push(
    writeGeneratedFile(
      join(root, 'src/index.ts'),
      `${barrelLines.join('\n')}\n`,
    ),
  );

  for (let i = 0; i < COMPILE_WORKLOAD.testFiles; i += 1) {
    const pA = (i * 2) % COMPILE_WORKLOAD.componentModules;
    const pB = (i * 2 + 1) % COMPILE_WORKLOAD.componentModules;
    writes.push(
      writeGeneratedFile(
        join(root, `tests/compile${i}.test.tsx`),
        `import { describe, expect, it } from '@rstest/core';
import { renderPanel${pA}, renderPanel${pB} } from '../src/index.ts';

describe('compile graph fixture ${i}', () => {
  it('renders panel ${pA} and ${pB} from the compiled TS/TSX graph', () => {
    const first = renderPanel${pA}(${i + 1});
    const second = renderPanel${pB}(${i + 2});

    expect(first.totalWeight).toBeGreaterThan(0);
    expect(second.totalWeight).toBeGreaterThan(0);
    expect(first.markup).toContain('data-panel="panel-${pA}"');
    expect(second.markup).toContain('data-panel="panel-${pB}"');
  });
});
`,
      ),
    );
  }

  await Promise.all(writes);
  return root;
}

async function createRunnerFixture() {
  const root = join(cpuFixturesRoot, 'runner');
  await initProjectRoot(root, '@rstest/bench-cpu-runner');

  await writeGeneratedFile(
    join(root, 'rstest.config.mts'),
    `import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  include: ['tests/**/*.test.ts'],
  isolate: false,
  performance: {
    buildCache: {
      cacheDirectory: '.cache/runner',
    },
  },
  pool: { type: 'forks', maxWorkers: 1 },
});
`,
  );

  const suiteGroups = RUNNER_WORKLOAD.suiteGroupsPerFile;
  const eachCases = RUNNER_WORKLOAD.eachCasesPerSuite;

  await Promise.all([
    writeGeneratedFile(
      join(root, 'tests/suitesAndHooks.test.ts'),
      `import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@rstest/core';

const cases = Array.from({ length: ${eachCases} }, (_, idx) => [
  idx,
  \`task-\${idx}\`,
  idx * 3 + 1,
] as const);

for (let group = 0; group < ${suiteGroups}; group += 1) {
  describe(\`runner suite group \${group}\`, () => {
    let suiteCounter = 0;
    let activeTrail: string[] = [];

    beforeAll(() => {
      suiteCounter = group * 10;
    });

    beforeEach(() => {
      activeTrail = [\`setup-\${group}\`];
    });

    afterEach(() => {
      suiteCounter += 1;
      activeTrail.length = 0;
    });

    afterAll(() => {
      expect(suiteCounter).toBeGreaterThan(group * 10);
    });

    it.each(cases)('validates parameterized case %i (%s)', (index, label, expected) => {
      activeTrail.push(label);
      const record = {
        group,
        index,
        label,
        score: index * 3 + 1,
        trail: [...activeTrail],
      };

      expect(record).toMatchObject({
        group,
        index,
        label,
        score: expected,
      });
      expect(record.trail).toEqual([\`setup-\${group}\`, label]);
    });

    describe('nested async assertions', () => {
      for (let step = 0; step < 6; step += 1) {
        it(\`resolves async batch \${step}\`, async () => {
          const batch = await Promise.all([
            Promise.resolve(group + step),
            Promise.resolve(group * 2 + step),
            Promise.resolve(step * 3),
          ]);
          expect(batch).toEqual([group + step, group * 2 + step, step * 3]);
          expect(batch.reduce((a, b) => a + b, 0)).toBe(group * 3 + step * 5);
        });
      }
    });
  });
}
`,
    ),
    writeGeneratedFile(
      join(root, 'tests/mocksAndMatchers.test.ts'),
      `import { afterEach, describe, expect, it, rstest } from '@rstest/core';

const payloads = Array.from({ length: ${eachCases} }, (_, idx) => ({
  id: \`item-\${idx}\`,
  nested: { count: idx + 1, tags: ['a', 'b', \`t-\${idx % 4}\`] },
  flags: { enabled: idx % 2 === 0, retries: idx % 3 },
}));

for (let group = 0; group < ${suiteGroups}; group += 1) {
  describe(\`runner mocks group \${group}\`, () => {
    afterEach(() => {
      rstest.restoreAllMocks();
    });

    it.each(payloads)('tracks fn and spyOn calls for $id', (payload) => {
      const target = {
        format: (id: string, count: number) => \`\${group}:\${id}:\${count}\`,
      };
      const spy = rstest.spyOn(target, 'format');
      const transform = rstest
        .fn((value: string) => value.toUpperCase())
        .mockName('transform');

      const formatted = target.format(payload.id, payload.nested.count);
      const upper = transform(formatted);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(payload.id, payload.nested.count);
      expect(transform).toHaveBeenCalledWith(formatted);
      expect(upper).toBe(formatted.toUpperCase());
      expect(payload).toEqual({
        id: payload.id,
        nested: {
          count: payload.nested.count,
          tags: ['a', 'b', expect.stringMatching(/^t-[0-3]$/)],
        },
        flags: {
          enabled: expect.any(Boolean),
          retries: expect.any(Number),
        },
      });
    });

    for (let step = 0; step < 6; step += 1) {
      it(\`checks async mock resolution \${step}\`, async () => {
        const loader = rstest.fn().mockResolvedValue({
          group,
          step,
          ok: true,
        });
        await expect(loader(step)).resolves.toEqual({ group, step, ok: true });
        expect(loader).toHaveBeenCalledTimes(1);
      });
    }
  });
}
`,
    ),
  ]);

  return root;
}

async function createJsdomFixture() {
  const root = join(cpuFixturesRoot, 'jsdom');
  await initProjectRoot(root, '@rstest/bench-cpu-jsdom', {
    withTsConfig: true,
  });

  await writeGeneratedFile(
    join(root, 'rstest.config.mts'),
    `import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  include: ['tests/**/*.test.tsx'],
  performance: { buildCache: false },
  pool: { type: 'forks', maxWorkers: 4 },
  testEnvironment: { name: 'jsdom', prebundle: 'auto' },
  tools: {
    swc: {
      jsc: {
        transform: {
          react: { runtime: 'automatic' },
        },
      },
    },
  },
});
`,
  );

  const writes = [
    writeGeneratedFile(
      join(root, 'src/apiClient.ts'),
      `export interface WidgetData {
  id: string;
  label: string;
  items: string[];
}

export function fetchWidgetData(seed: number): WidgetData {
  return {
    id: \`widget-\${seed}\`,
    label: \`Live Widget \${seed}\`,
    items: Array.from({ length: 12 }, (_, idx) => \`row-\${seed}-\${idx}\`),
  };
}
`,
    ),
  ];

  for (let i = 0; i < JSDOM_WORKLOAD.componentModules; i += 1) {
    writes.push(
      writeGeneratedFile(
        join(root, `src/Widget${i}.tsx`),
        `import { useState } from 'react';
import { fetchWidgetData } from './apiClient.ts';

export function Widget${i}({ seed }: { seed: number }) {
  const data = fetchWidgetData(seed + ${i});
  const [selected, setSelected] = useState(0);

  return (
    <section data-widget={data.id}>
      <h3>{data.label}</h3>
      <button
        type="button"
        data-action="next"
        onClick={() => setSelected((prev) => (prev + 1) % data.items.length)}
      >
        Select ({selected})
      </button>
      <ul>
        {data.items.map((item, idx) => (
          <li key={item} data-selected={idx === selected ? 'true' : 'false'}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
`,
      ),
    );
  }

  for (let i = 0; i < JSDOM_WORKLOAD.testFiles; i += 1) {
    const widgetIdx = i % JSDOM_WORKLOAD.componentModules;
    writes.push(
      writeGeneratedFile(
        join(root, `tests/widget${i}.test.tsx`),
        `import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, rstest } from '@rstest/core';

rstest.mock('../src/apiClient.ts', () => ({
  fetchWidgetData: rstest.fn((seed: number) => ({
    id: \`mock-widget-\${seed}\`,
    label: \`Mocked Widget \${seed}\`,
    items: Array.from({ length: 10 }, (_, idx) => \`mock-row-\${seed}-\${idx}\`),
  })),
}));

import { fetchWidgetData } from '../src/apiClient.ts';
import { Widget${widgetIdx} } from '../src/Widget${widgetIdx}.tsx';

describe('jsdom react widget ${i}', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
    rstest.clearAllMocks();
  });

  it('mounts, handles click state updates, and unmounts cleanly', async () => {
    const root = createRoot(host);

    await act(async () => {
      root.render(<Widget${widgetIdx} seed={${i}} />);
    });

    expect(fetchWidgetData).toHaveBeenCalledWith(${i + widgetIdx});
    expect(host.querySelectorAll('li')).toHaveLength(10);
    expect(host.querySelector('[data-selected="true"]')?.textContent).toBe(
      'mock-row-${i + widgetIdx}-0',
    );

    const button = host.querySelector<HTMLButtonElement>('[data-action="next"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
    });

    expect(host.querySelector('[data-selected="true"]')?.textContent).toBe(
      'mock-row-${i + widgetIdx}-1',
    );

    await act(async () => {
      root.unmount();
    });
  });
});
`,
      ),
    );
  }

  await Promise.all(writes);
  return root;
}

export async function createCpuFixtures() {
  await rm(cpuFixturesRoot, { force: true, recursive: true });
  await mkdir(cpuFixturesRoot, { recursive: true });

  try {
    const [startup, compile, runner, jsdom] = await Promise.all([
      createStartupFixture(),
      createCompileFixture(),
      createRunnerFixture(),
      createJsdomFixture(),
    ]);

    return {
      roots: { startup, compile, runner, jsdom },
      cleanup: async () => {
        await rm(cpuFixturesRoot, { force: true, recursive: true });
      },
    };
  } catch (error) {
    await rm(cpuFixturesRoot, { force: true, recursive: true });
    throw error;
  }
}
