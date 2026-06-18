import { readFile } from 'node:fs/promises';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.ts')) {
    return {
      shortCircuit: true,
      url: new URL(specifier, context.parentURL).href,
    };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = await readFile(new URL(url), 'utf-8');

    return {
      format: 'module',
      shortCircuit: true,
      source,
    };
  }

  return nextLoad(url, context);
}
