export function resolve(specifier, context, nextResolve) {
  if (specifier === 'cjs-module-lexer') {
    throw new Error('Native pools must not load the VM CommonJS lexer.');
  }
  return nextResolve(specifier, context);
}
