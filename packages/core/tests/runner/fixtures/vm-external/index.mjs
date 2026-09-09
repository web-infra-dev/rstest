import { createRequire } from 'node:module';
import path from 'node:path';
import isPlainObjectFromCommonJs from './helper.cjs';
import metadata from './data.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const requiredMetadata = require('./data.json');

export const inspectRealm = (value) => ({
  commonJs: isPlainObjectFromCommonJs(value),
  esm: Object.getPrototypeOf(value) === Object.prototype,
  filename: path.basename(import.meta.filename),
  importedJson: metadata.label,
  requiredJson: requiredMetadata.label,
});
