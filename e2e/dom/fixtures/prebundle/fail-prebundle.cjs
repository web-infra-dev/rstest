const fs = require('node:fs/promises');
const { syncBuiltinESMExports } = require('node:module');
const originalWriteFile = fs.writeFile;

const wrapJsdomExport = (data, body) =>
  data.replace(
    "export * from 'jsdom';",
    `import __rstestJsdomFs from 'node:fs';
import { CookieJar, JSDOM as __RstestBaseJSDOM, VirtualConsole } from 'jsdom';
export { CookieJar, VirtualConsole };
export class JSDOM extends __RstestBaseJSDOM {
  constructor(...args) {
    super(...args);
    ${body}
  }
}`,
  );

// Inject failures or instrumentation only into generated environment entries, never the native package.
fs.writeFile = function (path, data, ...args) {
  if (
    String(path).includes('rstest-test-environments') &&
    String(path).endsWith('entry.mjs')
  ) {
    // The generated entry is only written inside the prebundle child.
    if (process.env.PREBUNDLE_FAILURE === 'crash') {
      process.kill(process.pid, 'SIGKILL');
    } else if (process.env.PREBUNDLE_FAILURE === 'build') {
      data += '\nexport const = ;';
    } else if (process.env.PREBUNDLE_FAILURE === 'load') {
      data += '\nthrow new Error("injected prebundle load failure");';
    } else if (process.env.PREBUNDLE_FAILURE === 'probe') {
      data = wrapJsdomExport(
        data,
        `this.window.getComputedStyle = () => { throw new Error("injected prebundle probe failure"); };`,
      );
    } else if (process.env.PREBUNDLE_JSDOM_LOG) {
      data = wrapJsdomExport(
        data,
        `if (process.env.PREBUNDLE_JSDOM_LOG) { __rstestJsdomFs.appendFileSync(process.env.PREBUNDLE_JSDOM_LOG, process.pid + "\\n"); }`,
      );
    }
  }
  return originalWriteFile.call(this, path, data, ...args);
};
syncBuiltinESMExports();
