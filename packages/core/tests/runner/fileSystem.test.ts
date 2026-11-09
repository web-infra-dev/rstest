import { execFileSync } from 'node:child_process';
import nativeFs from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { getVmExternalModules } from '../../src/runtime/worker/vm/externalModules';

const fixture = new URL(
  './fixtures/vm-external/fs-composites.mjs',
  import.meta.url,
).href;
const cases = [
  { operation: 'writeFile', mock: 'open' },
  { operation: 'writeFile', mock: 'write' },
  { operation: 'writeFile', mock: 'write', style: 'partial' },
  { operation: 'writeFile', mock: 'close' },
  { operation: 'writeFile', mock: 'fsync', flush: true },
  { operation: 'writeFile', mock: 'write', closeError: true },
  { operation: 'writeFile', mock: 'write', fd: true },
  { operation: 'writeFile', mock: 'fsync', flush: true, fd: true },
  { operation: 'writeFile', mock: 'open', badData: true },
  { operation: 'writeFile', mock: 'write', style: 'partial', view: true },
  { operation: 'writeFile', mock: 'write', empty: true },
  { operation: 'writeFile', mock: 'open', abortBefore: true },
  { operation: 'writeFile', mock: 'write', abortBefore: true, fd: true },
  {
    operation: 'writeFile',
    mock: 'open',
    style: 'pass',
    abortAfterOpen: true,
    observeClose: true,
  },
  {
    operation: 'writeFile',
    mock: 'open',
    style: 'pass',
    abortAfterOpen: true,
    closeError: true,
  },
  { operation: 'appendFile', mock: 'open' },
  { operation: 'appendFile', mock: 'writeFile' },
  { operation: 'appendFile', mock: 'write', style: 'partial' },
  { operation: 'writeFileSync', mock: 'openSync', binary: true },
  { operation: 'writeFileSync', mock: 'writeSync', binary: true },
  {
    operation: 'writeFileSync',
    mock: 'writeSync',
    binary: true,
    style: 'partial',
  },
  { operation: 'writeFileSync', mock: 'fsyncSync', binary: true, flush: true },
  { operation: 'writeFileSync', mock: 'closeSync', binary: true },
  { operation: 'writeFileSync', mock: 'openSync', utf8: true },
  { operation: 'appendFileSync', mock: 'writeFileSync' },
  { operation: 'appendFileSync', mock: 'openSync', binary: true },
  { operation: 'readFileSync', mock: 'openSync' },
  { operation: 'readFileSync', mock: 'readSync' },
  { operation: 'readFileSync', mock: 'closeSync' },
  { operation: 'readFileSync', mock: 'openSync', utf8: true },
  { operation: 'readFileSync', mock: 'readSync', fd: true },
  { operation: 'readFile', mock: 'open' },
  { operation: 'truncate', mock: 'open' },
  { operation: 'truncate', mock: 'close' },
  { operation: 'truncate', mock: 'ftruncate' },
  { operation: 'truncate', mock: 'ftruncate', fd: true },
  { operation: 'truncateSync', mock: 'openSync' },
  { operation: 'truncateSync', mock: 'ftruncateSync' },
  { operation: 'truncateSync', mock: 'closeSync' },
  { operation: 'exists', mock: 'access' },
  { operation: 'exists', mock: 'access', throw: true },
  { operation: 'existsPromisified', mock: 'exists' },
  { operation: 'realpath', mock: 'lstat' },
  { operation: 'realpath', mock: 'stat', link: true },
  { operation: 'realpath', mock: 'readlink', link: true },
  { operation: 'realpath', mock: 'lstat', style: 'pass' },
  {
    operation: 'realpath',
    mock: 'lstat',
    style: 'pass',
    defaultCoercion: true,
  },
  { operation: 'realpath', mock: 'lstat', symbolPath: true },
  { operation: 'realpath', mock: 'lstat', nullPath: true },
  { operation: 'realpath', mock: 'readlink', style: 'pass', link: true },
  { operation: 'readStream', mock: 'open' },
  { operation: 'readStream', mock: 'read' },
  { operation: 'writeStream', mock: 'open' },
  { operation: 'writeStream', mock: 'write' },
  { operation: 'writeStream', mock: 'writev', vector: true },
  { operation: 'writeStream', mock: 'close' },
  { operation: 'writeStream', mock: 'fsync', flush: true },
  { operation: 'readStreamConstructor', mock: 'open' },
  { operation: 'writeStreamConstructor', mock: 'open' },
  { operation: 'writeStream', mock: 'open', customFs: true },
  { operation: 'writeStream', mock: 'open', customFs: true, inherited: true },
  { operation: 'writeStream', mock: 'open', hiddenEncoding: true },
  { operation: 'readStream', mock: 'open', handle: true },
];

type Scenario = (typeof cases)[number];
let expected: unknown[];
beforeAll(() => {
  expected = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          "import fs from 'node:fs';",
          `import { exercise } from ${JSON.stringify(fixture)};`,
          `const cases = ${JSON.stringify(cases)};`,
          'const results = [];',
          'for (const scenario of cases) results.push(await exercise(fs, scenario));',
          'console.log(JSON.stringify(results));',
        ].join('\n'),
      ],
      { encoding: 'utf8' },
    ),
  );
});

it.for(
  cases.map((scenario, index) => ({
    scenario,
    index,
    label: JSON.stringify(scenario),
  })),
)(
  'matches native fs dependency dispatch: $label',
  async ({ scenario, index }) => {
    const executor = getVmExternalModules(
      vm.createContext({ process, Buffer, AbortController }),
    );
    const originals = Object.fromEntries(
      Object.keys(nativeFs).map((name) => [name, Reflect.get(nativeFs, name)]),
    );
    try {
      // The external fixture is executed in the same VM as its native fs wrapper.
      const mod = (await executor.import(fixture, false, false)) as {
        exercise: (fileSystem: unknown, scenario: Scenario) => Promise<unknown>;
      };
      const fileSystem = executor.require(
        'node:fs',
        fileURLToPath(import.meta.url),
      );
      const result = await mod.exercise(fileSystem, scenario);
      expect(JSON.parse(JSON.stringify(result))).toEqual(expected[index]);
      expect(Reflect.get(nativeFs, scenario.mock)).toBe(
        originals[scenario.mock],
      );
    } finally {
      executor.dispose();
    }
  },
);
