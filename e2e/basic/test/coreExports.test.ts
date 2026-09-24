import * as core from '@rstest/core';
import {
  defineConfig,
  defineInlineProject,
  defineProject,
  expect,
  loadConfig,
  mergeProjectConfig,
  mergeRstestConfig,
  test,
} from '@rstest/core';
import { mergeSourceConfig, sourceTest } from '../src/index';

test('resolves package helpers alongside the runtime API', () => {
  for (const helper of [
    mergeRstestConfig,
    mergeProjectConfig,
    defineConfig,
    defineProject,
    defineInlineProject,
    loadConfig,
  ]) {
    expect(typeof helper).toBe('function');
  }
  expect(mergeRstestConfig({ retry: 1 }, { retry: 2 }).retry).toBe(2);
  expect(mergeProjectConfig({ retry: 3 }, { retry: 4 }).retry).toBe(4);
  expect(mergeSourceConfig().retry).toBe(7);
  expect(sourceTest).toBe(test);
});

test('exposes package helpers through namespace imports', () => {
  expect(typeof core.mergeRstestConfig).toBe('function');
  expect('mergeRstestConfig' in core).toBe(true);
  expect(Object.keys(core)).toContain('mergeRstestConfig');
  expect(core.test).toBe(test);
});
