import { createRequire } from 'node:module';
import path from 'node:path';
import timers, { setTimeout } from 'node:timers';
import { fromB } from './cycle/b.mjs';
import { throughD } from './cycle/c.mjs';
import isPlainObjectFromCommonJs from './realm-helper.cjs';
import moduleSemantics from './module-parent.cjs';
import metadata from './realm.json' with { type: 'json' };
import requiredEsm from './require-esm.cjs';

const require = createRequire(import.meta.url);
const requiredMetadata = require('./realm.json');

export const inspectRealm = (value) => ({
  commonJs: isPlainObjectFromCommonJs(value),
  esm:
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype,
  filename: path.basename(import.meta.filename),
  importedJson: metadata.label,
  moduleSemantics,
  requiredEsm,
  requiredJson: requiredMetadata.label,
  siblingCycle: [fromB(), throughD()],
  timers:
    timers.setTimeout === globalThis.setTimeout &&
    setTimeout === globalThis.setTimeout,
});
