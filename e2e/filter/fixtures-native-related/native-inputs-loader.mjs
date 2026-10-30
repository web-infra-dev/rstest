import { existsSync } from 'node:fs';

export default function nativeInputsLoader(source, sourceMap, additionalData) {
  for (const file of this.getOptions().files) {
    // Missing declarations remain dependencies after a native file is deleted.
    if (existsSync(file)) this.addDependency(file);
    else this.addMissingDependency(file);
  }
  this.callback(null, source, sourceMap, additionalData);
}
