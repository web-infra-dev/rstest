import { describe, expect, it } from '@rstest/core';
import {
  getSetupFiles,
  materializeVirtualSetupFiles,
} from '../../src/utils/getSetupFiles';

describe('getSetupFiles', () => {
  it('keeps JavaScript data URLs as virtual setup entries', () => {
    const setupFile =
      'data:text/javascript;base64,Y29uc29sZS5sb2coInNldHVwIik7';
    const result = materializeVirtualSetupFiles(
      getSetupFiles([setupFile], '/project'),
      '/project',
    );

    expect(Object.keys(result.setupFiles)[0]).toMatch(/^virtual~setup~/);
    expect(Object.values(result.setupFiles)[0]).toMatch(
      /^\/project\/.rstest-virtual\/virtual~setup~.+\.mjs$/,
    );
    expect(Object.values(result.virtualModules)).toEqual([
      'console.log("setup");',
    ]);
  });
});
