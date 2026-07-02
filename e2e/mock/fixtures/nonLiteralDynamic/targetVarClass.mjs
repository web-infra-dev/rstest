// Loaded natively via a non-literal `import(variable)`. Constructs a class
// imported from a mocked module — exercises that the synthetic native-mock
// module re-exports the class itself (not a non-constructible call wrapper).
import { Service } from './classDep.mjs';

export const probe = () => new Service().greet();
