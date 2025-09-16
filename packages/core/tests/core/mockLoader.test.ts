import { beforeEach, describe, expect, it, rs } from '@rstest/core';
import mockLoader from '../../src/core/plugins/mockLoader.mjs';

describe('mockLoader', () => {
  let mockContext: {
    resourcePath: string;
    async: () => (error: Error | null, result?: string, map?: any) => void;
  };
  let callback: ReturnType<typeof rs.fn>;

  beforeEach(() => {
    callback = rs.fn();
    mockContext = {
      resourcePath: '/path/to/test.js',
      async: () => callback,
    };
  });

  async function runLoader(source: string) {
    await mockLoader.call(mockContext, source, {});
    expect(callback).toHaveBeenCalled();
    const [error, result] = callback.mock.calls[0];
    expect(error).toBeNull();
    return result;
  }

  it('should transform default imports', async () => {
    const source = `import React from 'react';
console.log(React);`;

    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "const React = (await import('react')).default; export {};
      console.log(React);"
    `);
  });

  it('should transform namespace imports', async () => {
    const source = `import * as React from 'react';
console.log(React);`;

    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "const React = await import('react'); export {};
      console.log(React);"
    `);
  });

  it('should transform named imports', async () => {
    const source = `import { useState, useEffect } from 'react';
console.log(useState);`;

    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "const { useState, useEffect } = await import('react'); export {};
      console.log(useState);"
    `);
  });

  it('should transform named imports with aliases', async () => {
    const source = `import { useState as useStateAlias, useEffect } from 'react';
console.log(useStateAlias);`;

    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "const { useState: useStateAlias, useEffect } = await import('react'); export {};
      console.log(useStateAlias);"
    `);
  });

  it('should transform side-effect imports', async () => {
    const source = `import 'styles.css';
console.log('loaded');`;

    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "await import('styles.css'); export {};
      console.log('loaded');"
    `);
  });

  it('should transform mixed imports (default and named)', async () => {
    const source = `import React, { useState, useEffect } from 'react';
console.log(React, useState);`;

    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "const __rstest_import_react = await import('react');
      const React = __rstest_import_react.default;
      const { useState, useEffect } = __rstest_import_react; export {};
      console.log(React, useState);"
    `);
  });

  it('should transform mixed imports with namespace', async () => {
    const source = `import React, * as ReactAll from 'react';
import ReactDom, * as ReactDomAll from 'react-dom';
console.log(React, ReactAll);
console.log(ReactDom, ReactDomAll);
`;
    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "const __rstest_import_react = await import('react');
      const React = __rstest_import_react.default;
      const ReactAll = __rstest_import_react; export {};
      const __rstest_import_react_dom = await import('react-dom');
      const ReactDom = __rstest_import_react_dom.default;
      const ReactDomAll = __rstest_import_react_dom; export {};
      console.log(React, ReactAll);
      console.log(ReactDom, ReactDomAll);
      "
    `);
  });

  it('should skip dynamic imports', async () => {
    const source = `const React = import('react');
console.log(React);`;

    const result = await runLoader(source);

    expect(result).toEqual(source);
  });

  it('should handle multiple imports', async () => {
    const source = `import React from 'react';
import { useState } from 'react';
import * as ReactDOM from 'react-dom';
console.log(React, useState, ReactDOM);`;

    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "const React = (await import('react')).default; export {};
      const { useState } = await import('react'); export {};
      const ReactDOM = await import('react-dom'); export {};
      console.log(React, useState, ReactDOM);"
    `);
  });

  it('should hoist transformed imports while preserving order', async () => {
    const source = `// header comment
console.log('test');
await import('./a.mjs');
console.log('test1');
import './b.mjs';
console.log('test2');
import something from './c.mjs';
`;

    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "await import('./b.mjs'); export {};
      const something = (await import('./c.mjs')).default; export {};
      // header comment
      console.log('test');
      await import('./a.mjs');
      console.log('test1');
      console.log('test2');
      "
    `);
  });

  it('should add export {} flag for ESM modules', async () => {
    const source = `import React from 'react';
console.log(React);`;

    const result = await runLoader(source);

    expect(result).toMatchInlineSnapshot(`
      "const React = (await import('react')).default; export {};
      console.log(React);"
    `);
  });

  it('should handle errors gracefully', async () => {
    const errorCallback = rs.fn();
    const errorContext = {
      ...mockContext,
      async: () => errorCallback,
    };

    // Cause an error by passing null instead of a string
    await mockLoader.call(errorContext, null as any, {});

    expect(errorCallback).toHaveBeenCalled();
    const [error] = errorCallback.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
  });

  it('should preserve source maps', async () => {
    const source = `import React from 'react';`;
    const inputMap = {
      version: 3,
      sources: ['original.js'],
      names: ['React'],
      mappings: 'AAAA',
    };

    await mockLoader.call(mockContext, source, inputMap);

    const [error, , outputMap] = callback.mock.calls[0];
    expect(error).toBeNull();
    expect(outputMap).toBeDefined();
    expect(outputMap.names).toEqual(inputMap.names);
  });
});
