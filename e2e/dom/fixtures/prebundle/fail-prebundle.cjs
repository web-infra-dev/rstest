const fs = require('node:fs/promises');
const { syncBuiltinESMExports } = require('node:module');
const originalWriteFile = fs.writeFile;
// Inject failures only into generated environment entries, never the native package.
fs.writeFile = function (path, data, ...args) {
  if (
    String(path).includes('rstest-test-environments') &&
    String(path).endsWith('entry.mjs')
  ) {
    // The generated entry is only written inside the prebundle child.
    if (process.env.PREBUNDLE_FAILURE === 'crash') {
      process.kill(process.pid, 'SIGKILL');
    }
    data +=
      process.env.PREBUNDLE_FAILURE === 'build'
        ? '\nexport const = ;'
        : '\nthrow new Error("injected prebundle load failure");';
  }
  return originalWriteFile.call(this, path, data, ...args);
};
syncBuiltinESMExports();
