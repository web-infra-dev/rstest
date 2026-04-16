import path from 'node:path';
import Mocha from 'mocha';
import { glob } from 'tinyglobby';

export async function run() {
  // Force color output
  process.env.FORCE_COLOR = '1';
  process.env.NO_COLOR = '';

  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    timeout: 20_000, // 20 seconds
    color: true, // Force enable colors
  });

  const testsRoot = path.resolve(__dirname, '..');

  const files = await glob('**/**.test.js', { cwd: testsRoot });

  // Add files to the test suite
  for (const f of files) {
    mocha.addFile(path.resolve(testsRoot, f));
  }

  // Run the mocha test
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve(null);
      }
    });
  });
}
