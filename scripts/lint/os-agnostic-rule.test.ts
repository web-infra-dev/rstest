import path from 'node:path';
import { Rslint } from '@rslint/core';
import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';

// Tests the custom `rstest/os-agnostic-tests` rule defined in rslint.config.mts.
// Each fixture documents one syntax the rule bans or sanctions and is linted
// through @rslint/core, so the real rule runs — not a simulated AST walk.
//
// The rule is mounted via a minimal, project-free config
// (os-agnostic-rule.rslint.mjs) and fixtures are passed to lintText as buffers.
// No files touch disk, and skipping the type-aware program keeps each lint at
// ~85ms instead of ~900ms.

const RULE = 'rstest/os-agnostic-tests';
const configFile = path.join(__dirname, 'os-agnostic-rule.rslint.mjs');
// Virtual path for the linted buffer; nothing is read from disk. `.ts` so the
// buffer is parsed as TypeScript.
const fixturePath = path.join(__dirname, 'fixture.ts');

// name -> { code, hits }, where hits is the exact number of RULE violations the
// fixture must produce (0 = sanctioned).
const fixtures: Record<string, { code: string; hits: number }> = {
  'process.platform': { code: `const p = process.platform;`, hits: 1 },
  "process['platform']": {
    code: `const isWin = process['platform'] === 'win32';`,
    hits: 1,
  },
  'process[`platform`] (template-literal key)': {
    code: 'const p = process[`platform`];',
    hits: 1,
  },
  'globalThis[`process`].platform (template-literal key)': {
    code: 'const p = globalThis[`process`].platform;',
    hits: 1,
  },
  'globalThis.process.platform': {
    code: `const p = globalThis.process.platform;`,
    hits: 1,
  },
  'global.process.platform': {
    code: `const p = global.process.platform;`,
    hits: 1,
  },
  'platform destructured from process': {
    code: `const { platform: p } = process;\nexport { p };`,
    hits: 1,
  },
  'platform destructured from globalThis.process': {
    code: `const { platform: p } = globalThis.process;\nexport { p };`,
    hits: 1,
  },
  "named import of platform from 'node:process'": {
    code: `import { platform } from 'node:process';\nexport const p = platform;`,
    hits: 1,
  },
  'platform through an aliased default process import': {
    code: `import proc from 'node:process';\nexport const p = proc.platform;`,
    hits: 1,
  },
  'platform through a const-aliased process': {
    code: `const host = process;\nexport const p = host.platform;`,
    hits: 1,
  },
  'type() through a const-aliased os import': {
    code: `import os from 'node:os';\nconst host = os;\nexport const t = host.type();`,
    hits: 1,
  },
  "platform() through require('node:os')": {
    code: `const hostOs = require('node:os');\nexport const p = hostOs.platform();`,
    hits: 1,
  },
  "platform through require('node:process')": {
    code: `const proc = require('node:process');\nexport const p = proc.platform;`,
    hits: 1,
  },
  "platform destructured from require('node:process')": {
    code: `const { platform: p } = require('node:process');\nexport { p };`,
    hits: 1,
  },
  'platform destructured from a namespace os import': {
    code: `import * as hostOs from 'node:os';\nconst { platform: p } = hostOs;\nexport const win = p();`,
    hits: 1,
  },
  'type destructured from an os require': {
    code: `const os = require('node:os');\nconst { type: t } = os;\nexport const k = t();`,
    hits: 1,
  },
  "named import of platform from 'node:os'": {
    code: `import { platform } from 'node:os';\nexport const p = platform();`,
    hits: 1,
  },
  "renamed import of type from 'os'": {
    code: `import { type as osType } from 'os';\nexport const t = osType();`,
    hits: 1,
  },
  'platform() through an aliased default os import': {
    code: `import hostOs from 'node:os';\nexport const p = hostOs.platform();`,
    hits: 1,
  },
  'type() through an aliased namespace os import': {
    code: `import * as aliased from 'node:os';\nexport const t = aliased.type();`,
    hits: 1,
  },
  'sanctioned defineProperty stub/restore': {
    code: `const original = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { value: 'win32' });
if (original) Object.defineProperty(process, 'platform', original);`,
    hits: 0,
  },
  'platform-neutral os and process.env usage': {
    code: `import { tmpdir } from 'node:os';\nexport const dir = tmpdir();\nexport const ci = process.env.CI;`,
    hits: 0,
  },
};

let linter: Rslint;
beforeAll(() => {
  linter = new Rslint({ overrideConfigFile: configFile });
});
afterAll(() => linter.close());

const countHits = async (code: string): Promise<number> => {
  const results = await linter.lintText(code, { filePath: fixturePath });
  return results
    .flatMap((result) => result.messages)
    .filter((message) => message.ruleId === RULE).length;
};

describe('rstest/os-agnostic-tests', () => {
  for (const [name, { code, hits }] of Object.entries(fixtures)) {
    it(`${hits ? 'flags' : 'allows'} ${name}`, async () => {
      expect(await countHits(code)).toBe(hits);
    });
  }
});
