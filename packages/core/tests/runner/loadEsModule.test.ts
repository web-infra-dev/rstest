import { sep } from 'node:path';
import {
  clearModuleCache,
  loadModule,
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
});
