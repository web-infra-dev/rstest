import { singleton } from './singleton';

// Records the instance the setup file sees; mocking files must observe the
// same one from their test code.
(globalThis as Record<string, unknown>).__setupSingleton = singleton;
