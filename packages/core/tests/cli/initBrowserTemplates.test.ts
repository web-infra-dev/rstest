import { describe, expect, it } from '@rstest/core';
import {
  BROWSER_TEST_SCRIPT_KEY,
  DEFAULT_COMPONENT_BASE_NAME,
  getBrowserTestScript,
  getConfigFileName,
  getFileExtensions,
  getReactTestTemplate,
  getVanillaTestTemplate,
  resolveEffectiveFramework,
  rewriteComponentImport,
} from '../../src/cli/init/browser/templates';

describe('browser init layout owners', () => {
  it('composes the test:browser script from the owned config filename', () => {
    expect(getBrowserTestScript()).toBe(
      `rstest --config=${getConfigFileName()}`,
    );
    expect(BROWSER_TEST_SCRIPT_KEY).toBe('test:browser');
  });

  it('collapses a detected framework into a concrete template family', () => {
    expect(resolveEffectiveFramework('react')).toBe('react');
    expect(resolveEffectiveFramework(null)).toBe('vanilla');
  });

  it('derives the framework + language extension matrix', () => {
    expect(getFileExtensions('react', 'ts')).toEqual({
      componentExt: '.tsx',
      testExt: '.test.tsx',
    });
    expect(getFileExtensions('react', 'js')).toEqual({
      componentExt: '.jsx',
      testExt: '.test.jsx',
    });
    expect(getFileExtensions('vanilla', 'ts')).toEqual({
      componentExt: '.ts',
      testExt: '.test.ts',
    });
    expect(getFileExtensions('vanilla', 'js')).toEqual({
      componentExt: '.js',
      testExt: '.test.js',
    });
  });
});

describe('rewriteComponentImport', () => {
  it('leaves the default base name untouched', () => {
    const content = getReactTestTemplate('ts');
    expect(rewriteComponentImport(content, DEFAULT_COMPONENT_BASE_NAME)).toBe(
      content,
    );
  });

  it('rewrites the React test import to a deduplicated base name', () => {
    const content = getReactTestTemplate('ts');
    const rewritten = rewriteComponentImport(content, 'Counter_1');
    expect(rewritten).toContain("from './Counter_1.tsx'");
    expect(rewritten).not.toContain("from './Counter.tsx'");
  });

  it('rewrites the vanilla test import preserving the extension', () => {
    const content = getVanillaTestTemplate('js');
    const rewritten = rewriteComponentImport(content, 'Widget');
    expect(rewritten).toContain("from './Widget.js'");
    expect(rewritten).not.toContain("from './Counter.js'");
  });
});
