import runInPool, {
  runGlobalTeardown,
} from '../../../src/runtime/worker/globalSetupWorker';
import { uninstallVirtualFs } from '../../../src/runtime/worker/virtualFs';

const ENV_KEY = '__RSTEST_GLOBAL_SETUP_VIRTUAL_FS__';

describe('globalSetupWorker', () => {
  afterEach(async () => {
    delete process.env[ENV_KEY];
    await runGlobalTeardown();
    uninstallVirtualFs();
    delete (globalThis as Record<string, unknown>).__rstest_federation__;
  });

  it('allows federation global setup to read in-memory assets via fs', async () => {
    const distPath = '/virtual/global-setup.js';
    const assetPath = '/virtual/remote.txt';

    const result = await runInPool({
      type: 'setup',
      entries: [
        {
          distPath,
          testPath: '/virtual/global-setup.ts',
        },
      ],
      assetFiles: {
        [distPath]: `
const fs = require('node:fs');
module.exports.default = function () {
  process.env.${ENV_KEY} = fs.readFileSync(${JSON.stringify(assetPath)}, 'utf-8');
};
`,
        [assetPath]: 'virtual-content',
      },
      sourceMaps: {},
      interopDefault: false,
      outputModule: false,
      federation: true,
    });

    expect(result.success).toBe(true);
    expect(result.hasTeardown).toBe(false);
    expect(result.envChanges?.[ENV_KEY]).toBe('virtual-content');
  });
});
