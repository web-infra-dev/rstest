// Loaded natively via a non-literal `import(variable)`; imports a module mocked
// with an async factory, which the native path cannot serve — so it resolves to
// the real module.
import { value } from './asyncDep.mjs';

export const probe = () => value;
