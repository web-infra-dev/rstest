import { sep } from 'node:path';
import {
  appendSourceURL,
  clearModuleCache,
  loadModule,
  shouldInjectSourceURL,
} from '../../src/runtime/worker/loadEsModule';

describe('loadEsModule', () => {
  afterEach(() => {
    clearModuleCache();
  });

  it('should link nested modules that statically import builtins', async () => {
    const testPath = '/virtual/tests/runtime.test.ts';
    const distPath = '/virtual/dist/entry.mjs';
    const chunkPath = '/virtual/dist/chunk.mjs';

    const mod = await loadModule({
      codeContent: [
        "import chunk, { separator } from './chunk.mjs';",
        'export default {',
        '  hasReadFile: chunk,',
        '  separator,',
        '};',
      ].join('\n'),
      distPath,
      testPath,
      rstestContext: {},
      assetFiles: {
        [chunkPath]: [
          "import fs from 'node:fs';",
          "import path from 'node:path';",
          'export const separator = path.sep;',
          "export default typeof fs.readFile === 'function';",
        ].join('\n'),
      },
      interopDefault: false,
    });

    expect(mod.default).toEqual({
      hasReadFile: true,
      separator: sep,
    });
  });

  it('should append sourceURL for esm vm execution', () => {
    expect(
      appendSourceURL("throw new Error('x')", '/virtual/dist/entry.mjs'),
    ).toMatchInlineSnapshot(`
      "throw new Error('x')
      //# sourceURL=/virtual/dist/entry.mjs"
    `);
  });

  it('should not duplicate an existing sourceURL comment', () => {
    const code = [
      "throw new Error('x')",
      '//# sourceURL=/virtual/dist/original.mjs',
    ].join('\n');

    expect(appendSourceURL(code, '/virtual/dist/entry.mjs')).toBe(code);
  });

  it('should only inject sourceURL in Bun runtime', async () => {
    const originalBunVersion = process.versions.bun;

    try {
      Reflect.deleteProperty(process.versions, 'bun');
      expect(shouldInjectSourceURL()).toBe(false);

      process.versions.bun = originalBunVersion ?? '1.0.0';
      expect(shouldInjectSourceURL()).toBe(true);
    } finally {
      if (originalBunVersion === undefined) {
        Reflect.deleteProperty(process.versions, 'bun');
      } else {
        process.versions.bun = originalBunVersion;
      }
    }
  });
});
