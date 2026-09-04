import { createRequire } from 'node:module';
import path from 'node:path';
import timers, { setTimeout } from 'node:timers';
import helper from './helper.cjs';
import nonEnumerableModule from './non-enumerable.cjs';
import metadata from './data.json' with { type: 'json' };
import requiredEsm from './require-esm.cjs';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { exit as processExit, kill as processKill } from 'node:process';
import { verifyBuiltinSync } from './builtin-sync.mjs';
import { value as dataValue } from 'data:text/javascript,export%20const%20value%20=%20%22data-js%22';
import { value as javascriptDataValue } from 'data:application/javascript;charset=UTF-8,export%20const%20value%20=%20%22application-data-js%22';
import dataJson from 'data:application/json,%7B%22value%22%3A1%7D' with { type: 'json' };
import 'data:application/wasm;base64,AGFzbQEAAAA=';
import { exp as callExternalWasm } from './external.wasm';

const require = createRequire(import.meta.url);
const requiredMetadata = require('./data.json');

const commonJsPaths = require('./path-helper.cjs');

export const inspectRealm = (value) => ({
  commonJs: helper.isPlainObject(value),
  esm:
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype,
  filename: path.basename(import.meta.filename),
  dataUrls: {
    javascript: dataValue,
    javascriptApplication: javascriptDataValue,
    json: dataJson.value,
  },
  importedJson: metadata.label,
  jsonSameObject: metadata === requiredMetadata,
  nonEnumerableValue: nonEnumerableModule.value,
  plainDefault: { default: helper.default, named: helper.named },
  requiredEsm,
  requiredJson: requiredMetadata.label,
  timers:
    timers.setTimeout === globalThis.setTimeout &&
    setTimeout === globalThis.setTimeout,
  builtinSync: verifyBuiltinSync(),
  wasm: callExternalWasm(),
  wasmFunction: callExternalWasm instanceof Function,
});

export const verifyUnsupportedImportAttribute = async () => {
  try {
    await import('./helper.cjs', { with: { custom: 'value' } });
    return 'missing-error';
  } catch (error) {
    return error?.code;
  }
};

export const verifyImportAttributeErrorRealm = async () => {
  try {
    await import('./data.json');
    return false;
  } catch (error) {
    return error instanceof Error;
  }
};

export const verifyProcessGuards = () => {
  let killGuarded = false;
  let exitGuarded = false;
  try {
    processKill(process.pid, 'SIGTERM');
  } catch (error) {
    killGuarded = error?.message?.startsWith(
      'process.kill unexpectedly called',
    );
  }
  try {
    processExit(1);
  } catch (error) {
    exitGuarded = error?.message?.startsWith(
      'process.exit unexpectedly called',
    );
  }
  return { killGuarded, exitGuarded };
};

export const inspectCommonJsPaths = () => ({
  dirname: commonJsPaths.dirname,
  expected: path.dirname(commonJsPaths.filename),
});

export const verifyNodeGlobals = async () => {
  const pendingResponse = fetch('data:text/plain,vm');
  const response = await pendingResponse;
  const clonedBlob = structuredClone(new Blob(['blob']));
  const clonedTypeError = structuredClone(new TypeError('type-error'));
  const clonedError = structuredClone(
    new Error('outer', { cause: { value: 1 } }),
  );
  const clonedTypedArray = structuredClone(new Uint8Array([1]));
  return {
    blobSize: clonedBlob.size,
    blobText: await clonedBlob.text(),
    clonedBlob: clonedBlob instanceof Blob,
    clonedTypeError: clonedTypeError instanceof TypeError,
    clonedTypeErrorName: clonedTypeError.name,
    clonedErrorCause: clonedError.cause instanceof Object,
    clonedTypedArray: clonedTypedArray instanceof Uint8Array,
    clonedTypedArrayBuffer: clonedTypedArray.buffer instanceof ArrayBuffer,
    fetchPromise: pendingResponse instanceof Promise,
    responseText: await response.text(),
    structuredCloneObject: structuredClone({}) instanceof Object,
    structuredCloneNestedObject:
      structuredClone({ nested: {} }).nested instanceof Object,
  };
};

export const createTimerPromise = () =>
  require('node:timers/promises').setTimeout(0, 'timer');

export const createStaticTimerPromise = () =>
  setTimeoutPromise(0, 'static-timer');

export const importedImportMetaMain = {
  supported: Object.hasOwn(import.meta, 'main'),
  value: import.meta.main,
};
