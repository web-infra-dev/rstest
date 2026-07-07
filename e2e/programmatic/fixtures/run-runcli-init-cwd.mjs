import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCLI } from '@rstest/core/api';

// Scaffold into a throwaway directory that is NOT the process cwd, to prove
// `runCLI({ cwd })` threads through to the `init` command instead of writing
// into the bridge's own working directory.
const target = mkdtempSync(join(tmpdir(), 'rstest-init-cwd-'));
mkdirSync(target, { recursive: true });
writeFileSync(
  join(target, 'package.json'),
  `${JSON.stringify({ name: 'init-cwd-fixture', private: true }, null, 2)}\n`,
);

const cwdBefore = process.cwd();
let error = null;
try {
  await runCLI({
    argv: ['node', 'rstest', 'init', 'browser', '--yes'],
    cwd: target,
  });
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
}

const scaffoldedInTarget = existsSync(
  join(target, 'rstest.browser.config.mts'),
);
// The bug wrote into process.cwd(); assert nothing leaked there.
const leakedIntoCwd = existsSync(join(cwdBefore, 'rstest.browser.config.mts'));

rmSync(target, { recursive: true, force: true });

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    error,
    scaffoldedInTarget,
    leakedIntoCwd,
  })}__END__`,
);
