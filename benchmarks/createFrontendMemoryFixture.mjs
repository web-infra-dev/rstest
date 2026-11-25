import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const benchmarksNodeModules = join(__dirname, 'node_modules');
const fixturesMemoryDir = join(__dirname, 'fixtures', 'memory');

const DEFAULT_WORKLOAD = {
  featureCount: 10,
  rowsPerModule: 60,
  sharedModuleCount: 12,
  testFileCount: 36,
};

async function writeGeneratedFile(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function createPackageJson(pool) {
  return JSON.stringify(
    {
      name: `@rstest/synthetic-frontend-memory-${pool}`,
      private: true,
      type: 'module',
    },
    null,
    2,
  );
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

function createConfigFile({
  cacheDir,
  maxWorkers,
  memoryLimit,
  pool,
  prebundle,
}) {
  return `import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  include: ['tests/**/*.test.tsx'],
  setupFiles: ['./src/setupDom.ts'],
  performance: {
    buildCache: {
      cacheDirectory: ${JSON.stringify(cacheDir)},
    },
  },
  pool: ${JSON.stringify({
    maxWorkers,
    ...(pool === 'vmThreads' ? { memoryLimit } : {}),
    type: pool,
  })},
  testEnvironment: ${JSON.stringify({ name: 'jsdom', prebundle })},
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
`;
}

function createDomSetupFile() {
  return `(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
`;
}

function createAntdPanelComponent() {
  return `import { useState } from 'react';
import { Button, Card, ConfigProvider, Flex, List, Tag } from 'antd';

export interface DataRow {
  id: string;
  label: string;
  status: 'stable' | 'watch';
  value: number;
}

export interface AntdPanelProps {
  title: string;
  rows: readonly DataRow[];
}

export function AntdPanel({ title, rows }: AntdPanelProps) {
  const [filterStableOnly, setFilterStableOnly] = useState(false);
  const visibleRows = filterStableOnly
    ? rows.filter((row) => row.status === 'stable')
    : rows;
  const checksum = visibleRows.reduce((sum, row) => sum + row.value, 0);

  return (
    <ConfigProvider
      theme={{
        hashed: false,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 10,
        },
      }}
    >
      <Card
        title={title}
        size="small"
        extra={
          <Button
            size="small"
            data-filter-toggle="true"
            onClick={() => setFilterStableOnly((prev) => !prev)}
          >
            {filterStableOnly ? 'All' : 'Stable'}
          </Button>
        }
      >
        <Flex gap={12} vertical>
          <p data-panel-summary="true">
            rows={visibleRows.length} checksum={checksum}
          </p>
          <List
            size="small"
            bordered
            dataSource={visibleRows.slice(0, 30) as DataRow[]}
            renderItem={(row) => (
              <List.Item data-synthetic-row={row.id}>
                <Flex justify="space-between" style={{ width: '100%' }}>
                  <span>{row.label}</span>
                  <Tag color={row.status === 'stable' ? 'cyan' : 'purple'}>
                    {row.status}
                  </Tag>
                </Flex>
              </List.Item>
            )}
          />
        </Flex>
      </Card>
    </ConfigProvider>
  );
}
`;
}

function createThreeBridge() {
  return `import * as THREE from 'three';

export function buildThreeSnapshot(seed: number) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 100);
  camera.position.set(seed % 5, seed % 7, 12);
  scene.add(camera);

  const material = new THREE.MeshBasicMaterial({ color: 0x3366ff + seed });
  let checksum = 0;

  for (let index = 0; index < 18; index += 1) {
    const geometry = new THREE.BoxGeometry(
      1 + (index % 3) * 0.1,
      1 + (seed % 4) * 0.05,
      1 + ((seed + index) % 5) * 0.03,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(index * 0.2, seed * 0.01, (seed + index) * 0.02);
    scene.add(mesh);
    checksum += geometry.attributes.position.count;
  }

  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());

  return {
    checksum,
    meshCount: scene.children.length,
    footprint: Number((size.x + size.y + size.z).toFixed(3)),
  };
}
`;
}

function createSharedModule(index, rowsPerModule) {
  return `import type { DataRow } from '../heavy/AntdPanel.tsx';

export const data${index}: readonly DataRow[] = Array.from(
  { length: ${rowsPerModule} },
  (_, rowIndex) => ({
    id: 'data-${index}-' + rowIndex,
    label: 'Data ${index} row ' + rowIndex,
    status: rowIndex % 2 === 0 ? 'stable' : 'watch',
    value: (${index} + 1) * (rowIndex + 3),
  }),
);
`;
}

function createFeatureModule(index, sharedModuleCount) {
  const firstModule = index % sharedModuleCount;
  const secondModule = (index + 3) % sharedModuleCount;

  return `import { data${firstModule} } from '../shared/data${firstModule}.ts';
import { data${secondModule} } from '../shared/data${secondModule}.ts';
import { AntdPanel, type DataRow } from '../heavy/AntdPanel.tsx';
import { buildThreeSnapshot } from '../heavy/threeBridge.ts';

export function buildFeatureData${index}(seed: number): {
  rows: DataRow[];
  checksum: number;
  panelChecksum: number;
  meshCount: number;
  footprint: number;
} {
  const rows: DataRow[] = [...data${firstModule}, ...data${secondModule}].map(
    (row, rowIndex) => ({
      ...row,
      value: row.value + seed + rowIndex,
    }),
  );
  const panelChecksum = rows.reduce((sum, row) => sum + row.value, 0);
  const scene = buildThreeSnapshot(seed + ${index});

  return {
    rows,
    checksum: panelChecksum + scene.checksum,
    panelChecksum,
    meshCount: scene.meshCount,
    footprint: scene.footprint,
  };
}

export function FeatureView${index}({
  seed,
  rows,
}: {
  seed: number;
  rows: readonly DataRow[];
}) {
  return (
    <AntdPanel
      title={'Synthetic frontend panel ${index} #' + seed}
      rows={rows}
    />
  );
}
`;
}

function createTestFile(index, featureCount) {
  const featureIndex = index % featureCount;
  return `import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import {
  buildFeatureData${featureIndex},
  FeatureView${featureIndex},
} from '../../src/features/feature${featureIndex}.tsx';

describe('synthetic frontend test ${index}', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('mounts the Ant Design panel and computes the Three.js scene for fixture ${index}', async () => {
    const result = buildFeatureData${featureIndex}(${index});

    await act(async () => {
      root.render(<FeatureView${featureIndex} seed={${index}} rows={result.rows} />);
    });

    const renderedRows = host.querySelectorAll('[data-synthetic-row]');
    expect(renderedRows.length).toBe(30);
    expect(result.rows.length).toBeGreaterThan(100);
    expect(result.meshCount).toBeGreaterThan(5);
    expect(result.footprint).toBeGreaterThan(1);
    expect(result.checksum).toBeGreaterThan(result.panelChecksum);

    const toggle = host.querySelector<HTMLButtonElement>('[data-filter-toggle="true"]');
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle?.click();
    });

    expect(host.querySelector('[data-panel-summary="true"]')?.textContent).toContain(
      'rows=' + result.rows.filter((row) => row.status === 'stable').length,
    );
  });

  it('re-renders with an updated seed without retaining stale DOM nodes', async () => {
    const initial = buildFeatureData${featureIndex}(${index});
    const updated = buildFeatureData${featureIndex}(${index + 100});

    await act(async () => {
      root.render(<FeatureView${featureIndex} seed={${index}} rows={initial.rows} />);
    });
    await act(async () => {
      root.render(
        <FeatureView${featureIndex} seed={${index + 100}} rows={updated.rows.slice(0, 12)} />,
      );
    });

    expect(host.querySelectorAll('[data-synthetic-row]').length).toBe(12);
  });
});
`;
}

export async function createFrontendMemoryFixture({
  maxWorkers = 4,
  memoryLimit = '256MB',
  pool = 'forks',
  prebundle = 'auto',
  testFileCount = DEFAULT_WORKLOAD.testFileCount,
} = {}) {
  const workload = { ...DEFAULT_WORKLOAD, testFileCount };
  const fixtureRoot = join(fixturesMemoryDir, pool);
  const cacheDir = join(fixtureRoot, '.cache', 'run');

  await rm(fixtureRoot, { force: true, recursive: true });
  await mkdir(fixtureRoot, { recursive: true });

  try {
    await symlink(
      benchmarksNodeModules,
      join(fixtureRoot, 'node_modules'),
      'dir',
    );
    await writeGeneratedFile(
      join(fixtureRoot, 'package.json'),
      createPackageJson(pool),
    );
    await writeGeneratedFile(
      join(fixtureRoot, 'tsconfig.json'),
      createTsConfig(),
    );
    await writeGeneratedFile(
      join(fixtureRoot, 'rstest.config.mts'),
      createConfigFile({ cacheDir, maxWorkers, memoryLimit, pool, prebundle }),
    );
    await writeGeneratedFile(
      join(fixtureRoot, 'src/setupDom.ts'),
      createDomSetupFile(),
    );
    await writeGeneratedFile(
      join(fixtureRoot, 'src/heavy/AntdPanel.tsx'),
      createAntdPanelComponent(),
    );
    await writeGeneratedFile(
      join(fixtureRoot, 'src/heavy/threeBridge.ts'),
      createThreeBridge(),
    );

    await Promise.all(
      Array.from({ length: workload.sharedModuleCount }, (_, index) =>
        writeGeneratedFile(
          join(fixtureRoot, `src/shared/data${index}.ts`),
          createSharedModule(index, workload.rowsPerModule),
        ),
      ),
    );

    await Promise.all(
      Array.from({ length: workload.featureCount }, (_, index) =>
        writeGeneratedFile(
          join(fixtureRoot, `src/features/feature${index}.tsx`),
          createFeatureModule(index, workload.sharedModuleCount),
        ),
      ),
    );

    await Promise.all(
      Array.from({ length: workload.testFileCount }, (_, index) =>
        writeGeneratedFile(
          join(fixtureRoot, `tests/generated/feature${index}.test.tsx`),
          createTestFile(index, workload.featureCount),
        ),
      ),
    );
  } catch (error) {
    await rm(fixtureRoot, { force: true, recursive: true });
    throw error;
  }

  return {
    root: fixtureRoot,
    cacheDir,
    cleanup: async () => {
      await rm(fixtureRoot, { force: true, recursive: true });
    },
  };
}

export async function cleanupMemoryFixturesRoot() {
  await rm(fixturesMemoryDir, { force: true, recursive: true });
}
