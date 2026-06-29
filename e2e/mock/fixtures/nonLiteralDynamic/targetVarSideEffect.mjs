// Loaded natively via a non-literal `import(variable)`; imports the mocked
// side-effect module so the native load hook must evaluate the mock factory.
import { value } from './sideEffectDep.mjs';

export const probe = () => value;
