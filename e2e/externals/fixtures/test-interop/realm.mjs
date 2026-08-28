import { createRequire } from 'node:module';
import path from 'node:path';
import timers, { setTimeout } from 'node:timers';
import { fromB } from './cycle/b.mjs';
import { throughD } from './cycle/c.mjs';
import isPlainObjectFromCommonJs from './realm-helper.cjs';
import moduleSemantics from './module-parent.cjs';
import metadata from './realm.json' with { type: 'json' };
import requiredEsm from './require-esm.cjs';
import plainDefault from './plain-default.cjs';
import { value as dataValue } from 'data:text/javascript,export%20const%20value%20=%20%22data-js%22';
import dataJson from 'data:application/json,%7B%22value%22%3A1%7D' with { type: 'json' };
import 'data:application/wasm;base64,AGFzbQEAAAA=';
import { exp as callExternalWasm } from './external.wasm';

const require = createRequire(import.meta.url);
const requiredMetadata = require('./realm.json');

export const inspectRealm = (value) => ({
  commonJs: isPlainObjectFromCommonJs(value),
  esm:
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype,
  filename: path.basename(import.meta.filename),
  dataUrls: { javascript: dataValue, json: dataJson.value },
  importedJson: metadata.label,
  moduleSemantics,
  plainDefault,
  requiredEsm,
  requiredJson: requiredMetadata.label,
  siblingCycle: [fromB(), throughD()],
  timers:
    timers.setTimeout === globalThis.setTimeout &&
    setTimeout === globalThis.setTimeout,
  wasm: callExternalWasm(),
});
