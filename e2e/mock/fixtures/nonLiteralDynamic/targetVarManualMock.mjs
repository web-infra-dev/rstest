// Loaded natively via a non-literal `import(variable)`. Imports a builtin that
// is replaced by a manual mock (`__mocks__/dns.ts`) — exercises that a manual
// mock is published to the native registry, not only factory/option mocks.
import dns from 'node:dns';

export const probe = () => dns?.__tag;
