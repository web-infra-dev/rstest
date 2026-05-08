import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const benchmarksNodeModules = join(__dirname, 'node_modules');
const fixturesMemoryDir = join(__dirname, 'fixtures', 'memory');
const workload = {
  featureCount: 10,
  rowsPerModule: 80,
  sharedModuleCount: 12,
  testFileCount: 60,
};

async function writeGeneratedFile(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function createPackageJson() {
  return JSON.stringify(
    {
      name: '@rstest/synthetic-frontend-memory',
      private: true,
      type: 'module',
    },
    null,
    2,
  );
}

function createConfigFile() {
  return `import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  include: ['tests/**/*.test.ts'],
  testEnvironment: 'jsdom',
});
`;
}

function createAntdBridge() {
  return `import React from 'react';
import { Card, ConfigProvider, Flex, List, Tag } from 'antd';
import { renderToStaticMarkup } from 'react-dom/server';

export function renderAntdPanel(title, rows) {
  const checksum = rows.reduce((sum, row) => sum + row.value, 0);

  const tree = React.createElement(
    ConfigProvider,
    {
      theme: {
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 10,
        },
      },
    },
    React.createElement(
      Card,
      { title, size: 'small' },
      React.createElement(
        Flex,
        { gap: 12, vertical: true },
        React.createElement('p', null, 'rows=' + rows.length + ' checksum=' + checksum),
        React.createElement(List, {
          size: 'small',
          bordered: true,
          dataSource: rows.slice(0, 40),
          renderItem: (row) =>
            React.createElement(
              List.Item,
              { 'data-synthetic-row': row.id },
              React.createElement(
                Flex,
                { justify: 'space-between', style: { width: '100%' } },
                React.createElement('span', null, row.label),
                React.createElement(Tag, { color: row.status === 'stable' ? 'cyan' : 'purple' }, row.status),
              ),
            ),
        }),
      ),
    ),
  );

  return {
    checksum,
    markup: renderToStaticMarkup(tree),
    renderedRowCount: Math.min(rows.length, 40),
  };
}
`;
}

function createThreeBridge() {
  return `import * as THREE from 'three';

export function buildThreeSnapshot(seed) {
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

function createSharedModule(index) {
  return `export const data${index} = Array.from({ length: ${workload.rowsPerModule} }, (_, rowIndex) => ({
  id: 'data-${index}-' + rowIndex,
  label: 'Data ${index} row ' + rowIndex,
  status: rowIndex % 2 === 0 ? 'stable' : 'watch',
  value: (${index} + 1) * (rowIndex + 3),
}));
`;
}

function createFeatureModule(index) {
  const firstModule = index % workload.sharedModuleCount;
  const secondModule = (index + 3) % workload.sharedModuleCount;

  return `import { data${firstModule} } from '../shared/data${firstModule}.ts';
import { data${secondModule} } from '../shared/data${secondModule}.ts';
import { renderAntdPanel } from '../heavy/antdBridge.ts';
import { buildThreeSnapshot } from '../heavy/threeBridge.ts';

export function buildFeature${index}(seed) {
  const rows = [...data${firstModule}, ...data${secondModule}].map((row, rowIndex) => ({
    ...row,
    value: row.value + seed + rowIndex,
  }));
  const panel = renderAntdPanel('Synthetic frontend panel ${index}', rows);
  const scene = buildThreeSnapshot(seed + ${index});
  const checksum = rows.reduce((sum, row) => sum + row.value, 0) + scene.checksum;

  return {
    checksum,
    markup: panel.markup,
    meshCount: scene.meshCount,
    footprint: scene.footprint,
    renderedRowCount: panel.renderedRowCount,
    totalRowCount: rows.length,
    panelChecksum: panel.checksum,
  };
}
`;
}

function createTestFile(index) {
  const featureIndex = index % workload.featureCount;
  return `import { describe, expect, it } from '@rstest/core';
import { buildFeature${featureIndex} } from '../../src/features/feature${featureIndex}.ts';

describe('synthetic frontend test ${index}', () => {
  it('renders the generated frontend graph for fixture ${index}', () => {
    document.body.innerHTML = '';

    const result = buildFeature${featureIndex}(${index});
    const host = document.createElement('section');
    host.innerHTML = result.markup;
    document.body.append(host);

    expect(host.querySelectorAll('[data-synthetic-row]').length).toBe(result.renderedRowCount);
    expect(result.totalRowCount).toBeGreaterThan(100);
    expect(result.meshCount).toBeGreaterThan(5);
    expect(result.footprint).toBeGreaterThan(1);
    expect(result.checksum).toBeGreaterThan(result.panelChecksum);
  });
});
`;
}

export async function createFrontendMemoryFixture() {
  const fixtureRoot = fixturesMemoryDir;

  await rm(fixtureRoot, { force: true, recursive: true });
  await mkdir(fixtureRoot, { recursive: true });

  try {
    const nodeModulesLink = join(fixtureRoot, 'node_modules');

    await symlink(benchmarksNodeModules, nodeModulesLink, 'dir');
    await writeGeneratedFile(
      join(fixtureRoot, 'package.json'),
      createPackageJson(),
    );
    await writeGeneratedFile(
      join(fixtureRoot, 'rstest.config.mts'),
      createConfigFile(),
    );
    await writeGeneratedFile(
      join(fixtureRoot, 'src/heavy/antdBridge.ts'),
      createAntdBridge(),
    );
    await writeGeneratedFile(
      join(fixtureRoot, 'src/heavy/threeBridge.ts'),
      createThreeBridge(),
    );

    await Promise.all(
      Array.from({ length: workload.sharedModuleCount }, (_, index) =>
        writeGeneratedFile(
          join(fixtureRoot, `src/shared/data${index}.ts`),
          createSharedModule(index),
        ),
      ),
    );

    await Promise.all(
      Array.from({ length: workload.featureCount }, (_, index) =>
        writeGeneratedFile(
          join(fixtureRoot, `src/features/feature${index}.ts`),
          createFeatureModule(index),
        ),
      ),
    );

    await Promise.all(
      Array.from({ length: workload.testFileCount }, (_, index) =>
        writeGeneratedFile(
          join(fixtureRoot, `tests/generated/feature${index}.test.ts`),
          createTestFile(index),
        ),
      ),
    );
  } catch (error) {
    await rm(fixtureRoot, { force: true, recursive: true });
    throw error;
  }

  return {
    root: fixtureRoot,
    cleanup: async () => {
      await rm(fixtureRoot, { force: true, recursive: true });
    },
  };
}
