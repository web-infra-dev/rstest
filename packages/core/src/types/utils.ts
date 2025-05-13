export type MaybePromise<T> = T | Promise<T>;

export type FunctionLike = (...args: any) => any;

/** The test file output path */
export type DistPath = string;
/** The test file original path */
export type TestPath = string;
