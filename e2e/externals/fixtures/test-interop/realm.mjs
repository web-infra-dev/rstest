import { createRequire } from 'node:module';
import path from 'node:path';
import isPlainObjectFromCommonJs from './realm-helper.cjs';
import metadata from './realm.json' with { type: 'json' };

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
  requiredJson: requiredMetadata.label,
});
