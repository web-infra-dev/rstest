import {
  defineConfig,
  defineInlineProject,
  defineProject,
  describe,
  expect,
  it,
  loadConfig,
  mergeProjectConfig,
  mergeRstestConfig,
} from '@rstest/core';
import pathe from 'pathe';
import { sayHi } from '../src/index';

describe('Index', () => {
  it('should expose config helpers inside tests', async () => {
    const config = mergeRstestConfig({ retry: 1 }, { retry: 2 });
    expect(defineConfig(config).retry).toBe(2);
    expect(
      mergeProjectConfig(
        defineProject({ name: 'base', retry: 1 }),
        defineInlineProject({ name: 'project', retry: 2 }),
      ),
    ).toMatchObject({ name: 'project', retry: 2 });
    const loaded = await loadConfig({ cwd: __dirname });
    expect(loaded.filePath).toBeNull();
    expect(loaded.content).toEqual({});
  });

  it('should add two numbers correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('should test source code correctly', () => {
    expect(sayHi()).toBe('hi');
  });

  it('should get RSTEST flag correctly', () => {
    expect(process.env.RSTEST).toBe('true');
  });

  it('should get WORKER ID correctly', () => {
    expect(process.env.RSTEST_WORKER_ID).toBeDefined();
  });

  it('should use node API correctly', async () => {
    expect(
      pathe
        .resolve(__dirname, '../src/index.ts')
        .endsWith('/basic/src/index.ts'),
    ).toBeTruthy();
  });

  it('should use require.resolve correctly', async () => {
    const resolved = require.resolve('../src/index.ts');
    // TODO: can't write as  require.resolve('../src/index.ts').endsWith('index.ts')
    expect(resolved.endsWith('index.ts')).toBeTruthy();
  });
});
