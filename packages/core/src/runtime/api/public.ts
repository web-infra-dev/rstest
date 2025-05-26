import type { Rstest, RstestUtilities } from '../../types';
export type { Assertion } from '../../types/expect';

export declare const expect: Rstest['expect'];
export declare const assert: Rstest['assert'];
export declare const it: Rstest['it'];
export declare const test: Rstest['test'];
export declare const describe: Rstest['describe'];
export declare const beforeAll: Rstest['beforeAll'];
export declare const afterAll: Rstest['afterAll'];
export declare const beforeEach: Rstest['beforeEach'];
export declare const afterEach: Rstest['afterEach'];
export declare const rstest: RstestUtilities;
