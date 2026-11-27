import { normalize, resolve } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  applyModifyConfig,
  isNodeTarget,
  resolveCacheDependency,
  resolveTestEnvironmentFromTarget,
} from '../src/adapter';

describe('resolveCacheDependency', () => {
  it('normalizes an absolute dependency', () => {
    expect(
      resolveCacheDependency({ dependency: resolve('/repo/a/../b/dep.ts') }),
    ).toBe(normalize(resolve('/repo/b/dep.ts')));
  });

  it('resolves a relative dependency against the config file directory', () => {
    expect(
      resolveCacheDependency({
        dependency: './dep.ts',
        configPath: resolve('/repo/configs/app.config.ts'),
        // `root` is ignored when `configPath` is present
        root: resolve('/repo/project'),
      }),
    ).toBe(normalize(resolve('/repo/configs/dep.ts')));
  });

  it('resolves a relative dependency against root when no config path', () => {
    expect(
      resolveCacheDependency({
        dependency: './dep.ts',
        root: resolve('/repo/project'),
      }),
    ).toBe(normalize(resolve('/repo/project/dep.ts')));
  });

  it('returns a bare relative dependency unchanged when no base is given', () => {
    expect(resolveCacheDependency({ dependency: './dep.ts' })).toBe('./dep.ts');
  });

  it('produces identical keys for identical inputs (no cross-adapter drift)', () => {
    const input = {
      dependency: './shared/dep.ts',
      configPath: resolve('/repo/configs/app.config.ts'),
    };
    // Whichever adapter computes this, the cache key must match.
    expect(resolveCacheDependency(input)).toBe(
      normalize(resolve('/repo/configs/shared/dep.ts')),
    );
  });
});

describe('isNodeTarget', () => {
  it('recognizes node-like single-string targets', () => {
    expect(isNodeTarget('node')).toBe(true);
    expect(isNodeTarget('async-node')).toBe(true);
    expect(isNodeTarget('node18.0')).toBe(true);
  });

  it('treats web / undefined / false as non-node', () => {
    expect(isNodeTarget('web')).toBe(false);
    expect(isNodeTarget('web-worker')).toBe(false);
    expect(isNodeTarget(undefined)).toBe(false);
    expect(isNodeTarget(false)).toBe(false);
    expect(isNodeTarget([])).toBe(false);
  });

  it('detects a node target inside an array (rspack multi-target)', () => {
    expect(isNodeTarget(['web', 'async-node'])).toBe(true);
    expect(isNodeTarget(['web', 'web-worker'])).toBe(false);
  });
});

describe('resolveTestEnvironmentFromTarget', () => {
  it('maps node targets to node and everything else to happy-dom', () => {
    expect(resolveTestEnvironmentFromTarget('node')).toBe('node');
    expect(resolveTestEnvironmentFromTarget('async-node')).toBe('node');
    expect(resolveTestEnvironmentFromTarget('web')).toBe('happy-dom');
    expect(resolveTestEnvironmentFromTarget(undefined)).toBe('happy-dom');
  });
});

describe('applyModifyConfig', () => {
  it('returns the original config when callback is omitted', () => {
    const config = { source: { define: { A: '1' } } };
    expect(applyModifyConfig(config)).toBe(config);
  });

  it('keeps in-place mutations when callback returns void without mutating input', () => {
    const plugin = { name: 'keep-plugin', setup: () => {} };
    const extraPlugin = { name: 'extra-plugin', setup: () => {} };
    const pattern = /\.json5$/;
    const input: {
      target?: string;
      plugins: Array<{ name: string; setup: () => void }>;
      source: {
        assetsInclude: RegExp;
        define?: Record<string, string>;
      };
    } = {
      target: 'web',
      plugins: [plugin],
      source: {
        assetsInclude: pattern,
        define: { FOO: '"bar"' },
      },
    };

    const result = applyModifyConfig(input, (config) => {
      config.target = 'node';
      delete config.source.define;
      config.plugins.push(extraPlugin);
    });

    expect(result.target).toBe('node');
    expect(result.source.define).toBeUndefined();
    expect(result.source.assetsInclude).toBe(pattern);
    expect(result.plugins).toEqual([plugin, extraPlugin]);
    expect(result.plugins[0]).toBe(plugin);

    expect(input.target).toBe('web');
    expect(input.source.define).toEqual({ FOO: '"bar"' });
    expect(input.plugins).toEqual([plugin]);
  });

  it('uses the returned config when callback returns a replacement object', () => {
    const input = { target: 'web' };
    const replacement = { target: 'node' };

    const result = applyModifyConfig(input, () => replacement);

    expect(result).toBe(replacement);
    expect(input.target).toBe('web');
  });
});
