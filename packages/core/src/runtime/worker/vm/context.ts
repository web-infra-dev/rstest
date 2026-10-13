import { Script, type Context } from 'node:vm';

const captureVmContextKeysScript = new Script(
  'Object.getOwnPropertyNames(globalThis).concat(Object.getOwnPropertySymbols(globalThis))',
);
const stripVmContextScript = new Script(`(initialKeys) => {
  const globalObject = globalThis;
  try { globalObject.document.body.textContent = ''; } catch {}
  try { globalObject.document.head.textContent = ''; } catch {}
  let keys = [];
  try {
    keys = Object.getOwnPropertyNames(globalObject).concat(Object.getOwnPropertySymbols(globalObject));
  } catch {}
  for (const key of keys) {
    if (initialKeys.has(key)) continue;
    try { delete globalObject[key]; } catch {}
  }
}`);

export const captureVmContextKeys = (
  context: Context,
): Set<string | symbol> => {
  try {
    return new Set(captureVmContextKeysScript.runInContext(context));
  } catch {
    return new Set();
  }
};

export const stripVmContext = (
  context: Context,
  initialKeys: Set<string | symbol>,
): void => {
  try {
    stripVmContextScript.runInContext(context)(initialKeys);
  } catch {
    // The context may already be in the process of being torn down.
  }
};
