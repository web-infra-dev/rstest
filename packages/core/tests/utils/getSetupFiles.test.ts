import { describe, expect, it } from '@rstest/core';
import {
  getSetupFiles,
  materializeVirtualSetupFiles,
} from '../../src/utils/getSetupFiles';

describe('getSetupFiles', () => {
  it('materializes JavaScript data URLs as virtual setup modules', () => {
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

  it('materializes empty JavaScript data URLs as virtual setup modules', () => {
    const result = materializeVirtualSetupFiles(
      getSetupFiles(['data:text/javascript;base64,'], '/project'),
      '/project',
    );

    expect(Object.values(result.virtualModules)).toEqual(['']);
  });

  it('matches supported data URL metadata case-insensitively', () => {
    const result = materializeVirtualSetupFiles(
      getSetupFiles(
        ['data:TEXT/JAVASCRIPT;charset=UTF-8;base64,Y29uc29sZS5sb2coMSk%3D'],
        '/project',
      ),
      '/project',
    );

    expect(Object.values(result.virtualModules)).toEqual(['console.log(1)']);
  });

  it('trims JavaScript data URL metadata tokens', () => {
    const result = materializeVirtualSetupFiles(
      getSetupFiles(
        ['data:text/javascript ; base64 ,Y29uc29sZS5sb2coMSk%3D'],
        '/project',
      ),
      '/project',
    );

    expect(Object.values(result.virtualModules)).toEqual(['console.log(1)']);
  });

  it('does not virtualize non-Base64 JavaScript data URLs', () => {
    expect(() =>
      getSetupFiles(
        ['data:text/javascript,globalThis.ready%20%3D%20true'],
        '/project',
      ),
    ).toThrow();
  });

  it.each(['#v1', '?AAAA', '?AAAA#v1', '#v1?AAAA'])(
    'does not include the URL suffix %s in the virtual module source',
    (suffix) => {
      const result = materializeVirtualSetupFiles(
        getSetupFiles(
          [`data:text/javascript;base64,dm9pZCAw${suffix}`],
          '/project',
        ),
        '/project',
      );

      expect(Object.values(result.virtualModules)).toEqual(['void 0']);
    },
  );
});
