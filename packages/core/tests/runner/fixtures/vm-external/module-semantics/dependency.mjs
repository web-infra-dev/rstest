import path from 'node:path';
import { fromB } from '../cross-cycle/b.mjs';
import { throughD } from '../cross-cycle/c.mjs';
import metadata from '../data.json' with { type: 'json' };
import bridge from './bridge.cjs';
import commonJsDefault, {
  cjsValue,
  'module.exports' as commonJsModuleExports,
} from './dependency.cjs';

export const commonJsValue = commonJsDefault.cjsValue;
export const bridgeValue = bridge.bridgeValue;
export const cycle = [fromB(), throughD()];
export const filename = path.basename(import.meta.filename);
export const jsonLabel = metadata.label;
export const jsonSameRealm =
  Object.getPrototypeOf(metadata) === Object.prototype;
export const loadDynamic = () => import('./import-first.mjs');
export const realmObject = {};
export const state = {};
export const value = 'esm';

if (cjsValue !== commonJsValue || commonJsModuleExports !== commonJsDefault) {
  throw new Error('CommonJS named exports were not linked.');
}
