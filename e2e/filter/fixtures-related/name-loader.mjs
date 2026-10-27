import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export default function nameLoader(source) {
  const { inputs } = this.getOptions();
  const prefix = join(inputs, 'prefix.txt');
  const parts = join(inputs, 'parts');
  const suffix = join(inputs, 'optional.txt');
  this.addDependency(prefix);
  this.addContextDependency(parts);
  if (existsSync(suffix)) {
    this.addDependency(suffix);
  } else {
    this.addMissingDependency(suffix);
  }

  const name =
    readFileSync(prefix, 'utf8').trim() +
    readdirSync(parts)
      .sort()
      .map((file) => readFileSync(join(parts, file), 'utf8').trim())
      .join('') +
    (existsSync(suffix) ? readFileSync(suffix, 'utf8').trim() : 'x');
  return source.replace("'index'", JSON.stringify(name));
}
